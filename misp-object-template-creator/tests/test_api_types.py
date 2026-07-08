"""Tests for type/category lookup API endpoints."""

import json


def test_get_describe_types(client):
    res = client.get("/api/describe-types")
    assert res.status_code == 200
    data = res.get_json()
    assert "types" in data
    assert "categories" in data
    assert "category_type_mappings" in data
    assert "sane_defaults" in data
    assert len(data["types"]) > 100
    assert len(data["categories"]) == 16


def test_get_meta_categories(client):
    res = client.get("/api/meta-categories")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert "file" in data
    assert "network" in data
    assert "misc" in data
    # "transport" was added upstream; the list must track schema_objects.json
    # rather than a hand-maintained copy, so assert against the schema enum.
    assert "transport" in data
    import json
    import config
    with open(config.SCHEMA_OBJECTS_PATH) as f:
        schema_enum = json.load(f)["properties"]["meta-category"]["enum"]
    assert data == schema_enum


def test_get_types(client):
    res = client.get("/api/types")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) > 100
    # Check structure of first item
    first = data[0]
    assert "type" in first
    assert "categories" in first
    assert "default_category" in first
    assert "default_to_ids" in first


def test_get_type_categories_valid(client):
    res = client.get("/api/types/ip-src/categories")
    assert res.status_code == 200
    data = res.get_json()
    assert data["type"] == "ip-src"
    assert "Network activity" in data["categories"]
    assert data["default_category"] == "Network activity"
    assert data["default_to_ids"] is True


def test_get_type_categories_composite_type(client):
    """Types with special characters like domain|ip should work."""
    res = client.get("/api/types/domain|ip/categories")
    assert res.status_code == 200
    data = res.get_json()
    assert data["type"] == "domain|ip"


def test_get_type_categories_unknown(client):
    res = client.get("/api/types/nonexistent-type/categories")
    assert res.status_code == 404
    data = res.get_json()
    assert "error" in data


def test_generate_uuid(client):
    res = client.get("/api/uuid")
    assert res.status_code == 200
    data = res.get_json()
    assert "uuid" in data
    # Should be a valid UUID
    import uuid
    uuid.UUID(data["uuid"])

    # Two calls should produce different UUIDs
    res2 = client.get("/api/uuid")
    assert res2.get_json()["uuid"] != data["uuid"]
