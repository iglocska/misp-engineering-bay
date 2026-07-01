"""Structural validation tests (PRD task 2.1, Layer 1).

Every bundled library template must validate clean against schema_event_template.json,
and a set of deliberately-broken documents must be rejected.
"""

import glob
import json
import os

import config
import validator


def _library_definitions():
    pattern = os.path.join(config.LIBRARY_TEMPLATES_DIR, "*", "definition.json")
    return sorted(glob.glob(pattern))


def test_library_present():
    defs = _library_definitions()
    assert len(defs) >= 5, "expected the misp-event-templates submodule to be populated"


def test_all_library_templates_validate_clean():
    for path in _library_definitions():
        with open(path, encoding="utf-8") as f:
            definition = json.load(f)
        result = validator.validate_template(definition)
        assert result.valid, f"{os.path.basename(os.path.dirname(path))} failed: {result.errors}"


def _base():
    """A minimal structurally-valid definition to mutate in the negative tests."""
    return {
        "schema_version": 1,
        "uuid": "294bf4d1-c2b2-47ed-94d4-07ef5a3730e3",
        "name": "Test template",
        "event_defaults": {},
        "structure": [
            {"type": "section", "id": "s_main", "label": "Main"},
        ],
    }


def test_base_is_valid():
    assert validator.validate_template(_base()).valid


def test_missing_required_name():
    d = _base()
    del d["name"]
    assert not validator.validate_template(d).valid


def test_wrong_schema_version():
    d = _base()
    d["schema_version"] = 2
    assert not validator.validate_template(d).valid


def test_bad_uuid_format():
    d = _base()
    d["uuid"] = "not-a-uuid"
    assert not validator.validate_template(d).valid


def test_distribution_4_requires_sharing_group():
    d = _base()
    d["event_defaults"] = {"distribution": 4}
    assert not validator.validate_template(d).valid, "distribution=4 without sharing_group_id must fail"
    d["event_defaults"]["sharing_group_id"] = 1
    assert validator.validate_template(d).valid


def test_attribute_field_requires_misp():
    d = _base()
    d["structure"].append({
        "type": "attribute_field", "id": "a1", "label": "Attr",
    })  # missing required 'misp'
    assert not validator.validate_template(d).valid


def test_bad_element_id_pattern():
    d = _base()
    d["structure"].append({"type": "section", "id": "1-bad id", "label": "X"})
    assert not validator.validate_template(d).valid


def test_additional_property_rejected():
    d = _base()
    d["surprise"] = True
    assert not validator.validate_template(d).valid


def test_api_validate_endpoint(client):
    res = client.post("/api/templates/validate", json=_base())
    assert res.status_code == 200
    body = res.get_json()
    assert body["valid"] is True
    # invalid doc still returns 200 with valid=false (draft-permissive; PRD D8)
    bad = _base()
    del bad["name"]
    res2 = client.post("/api/templates/validate", json=bad)
    assert res2.status_code == 200
    assert res2.get_json()["valid"] is False
