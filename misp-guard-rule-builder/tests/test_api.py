import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, ROOT)

from app import app  # noqa: E402


def test_sample_config_is_valid():
    client = app.test_client()
    sample = client.get('/api/sample')
    assert sample.status_code == 200
    response = client.post('/api/rules/validate', json=sample.get_json())
    assert response.status_code == 200
    assert response.get_json()['valid'] is True


def test_invalid_instance_compartment_is_rejected():
    client = app.test_client()
    data = client.get('/api/sample').get_json()
    data['instances']['instance_1_1']['compartment_id'] = 'missing'
    response = client.post('/api/rules/validate', json=data)
    assert response.status_code == 200
    body = response.get_json()
    assert body['valid'] is False
    assert any(error['path'].endswith('compartment_id') for error in body['errors'])


def test_export_returns_json_attachment():
    client = app.test_client()
    data = client.get('/api/sample').get_json()
    response = client.post('/api/rules/export', json=data)
    assert response.status_code == 200
    assert response.mimetype == 'application/json'
    assert 'misp-guard-config.json' in response.headers['Content-Disposition']
    assert json.loads(response.data)['instances']
