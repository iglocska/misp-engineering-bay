"""Tests for template CRUD API endpoints."""

import json
import uuid


def test_list_templates(client):
    """Should return all templates from the submodule."""
    res = client.get("/api/templates")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) > 100
    # Check structure
    first = data[0]
    assert "name" in first
    assert "description" in first
    assert "meta-category" in first
    assert "attribute_count" in first
    assert "source" in first


def test_list_templates_filter_by_name(client):
    res = client.get("/api/templates?name=file")
    assert res.status_code == 200
    data = res.get_json()
    assert all("file" in t["name"] for t in data)
    assert len(data) > 0


def test_list_templates_filter_by_category(client):
    res = client.get("/api/templates?meta-category=network")
    assert res.status_code == 200
    data = res.get_json()
    assert all(t["meta-category"] == "network" for t in data)
    assert len(data) > 0


def test_get_template_from_submodule(client):
    res = client.get("/api/templates/file")
    assert res.status_code == 200
    data = res.get_json()
    assert data["name"] == "file"
    assert data["meta-category"] == "file"
    assert "attributes" in data
    assert len(data["attributes"]) > 10
    assert data["_source"] == "misp-objects"


def test_get_template_not_found(client):
    res = client.get("/api/templates/nonexistent-template-xyz")
    assert res.status_code == 404
    assert "error" in res.get_json()


def test_list_templates_exposes_directory_identifier(client):
    """Listings must include `dir` so the UI can fetch templates whose
    on-disk directory name differs from their JSON `name` field
    (e.g. dir `persnona` / name `Deception PersNOna`)."""
    res = client.get("/api/templates")
    data = res.get_json()
    persnona = next((t for t in data if t.get("dir") == "persnona"), None)
    assert persnona is not None, "persnona template missing from listing"
    assert persnona["name"] == "Deception PersNOna"


def test_get_template_with_mismatched_dir_and_name(client):
    """Fetching by directory name must work even when JSON name differs."""
    res = client.get("/api/templates/persnona")
    assert res.status_code == 200
    data = res.get_json()
    assert data["name"] == "Deception PersNOna"
    assert "attributes" in data


def test_create_template(client, sample_template):
    res = client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    assert res.status_code == 201
    data = res.get_json()
    assert data["valid"] is True
    assert "path" in data

    # Verify it appears in listing
    res2 = client.get("/api/templates?name=test-object")
    found = [t for t in res2.get_json() if t["name"] == "test-object"]
    assert len(found) == 1
    assert found[0]["source"] == "user"


def test_create_template_rejects_existing_submodule_name(client, sample_template):
    """Creating a template with the same name as a submodule template should fail."""
    sample_template["name"] = "file"
    res = client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    assert res.status_code == 409
    assert "already exists in the misp-objects repository" in res.get_json()["error"]


def test_create_template_duplicate(client, sample_template):
    # Create once
    client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    # Create again — should fail with 409
    res = client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    assert res.status_code == 409
    assert "already exists" in res.get_json()["error"]


def test_create_template_invalid(client):
    bad = {"name": "", "version": -1}
    res = client.post(
        "/api/templates",
        data=json.dumps(bad),
        content_type="application/json",
    )
    assert res.status_code == 422
    data = res.get_json()
    assert data["valid"] is False
    assert len(data["errors"]) > 0


def test_create_template_no_body(client):
    res = client.post("/api/templates", content_type="application/json")
    assert res.status_code == 400


def test_update_template(client, sample_template):
    # Create first
    client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    # Update with new description
    sample_template["description"] = "Updated description"
    sample_template["version"] = 2
    res = client.put(
        f"/api/templates/{sample_template['name']}",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["valid"] is True

    # Verify update persisted
    res2 = client.get(f"/api/templates/{sample_template['name']}")
    assert res2.get_json()["description"] == "Updated description"
    assert res2.get_json()["version"] == 2


def test_update_template_name_mismatch(client, sample_template):
    body = {**sample_template, "name": "different-name"}
    res = client.put(
        f"/api/templates/{sample_template['name']}",
        data=json.dumps(body),
        content_type="application/json",
    )
    assert res.status_code == 400
    assert "does not match" in res.get_json()["error"]


def test_update_template_invalid(client, sample_template):
    # Create first
    client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    # Try to update with invalid data
    bad = {**sample_template, "meta-category": "invalid-category"}
    res = client.put(
        f"/api/templates/{sample_template['name']}",
        data=json.dumps(bad),
        content_type="application/json",
    )
    assert res.status_code == 422


def test_delete_template(client, sample_template):
    # Create first
    client.post(
        "/api/templates",
        data=json.dumps(sample_template),
        content_type="application/json",
    )
    # Delete
    res = client.delete(f"/api/templates/{sample_template['name']}")
    assert res.status_code == 200
    assert "deleted" in res.get_json()["message"]

    # Verify it's gone from user output (should fall back to submodule or 404)
    res2 = client.get(f"/api/templates/{sample_template['name']}")
    assert res2.status_code == 404


def test_delete_submodule_template(client):
    """Deleting a submodule-only template should be forbidden."""
    res = client.delete("/api/templates/file")
    assert res.status_code == 403
    assert "Cannot delete" in res.get_json()["error"]


def test_delete_nonexistent_template(client):
    res = client.delete("/api/templates/nonexistent-xyz-abc")
    assert res.status_code == 404
