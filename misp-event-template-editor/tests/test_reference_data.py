"""Tests for the offline reference-data loaders and their API endpoints (PRD task 1.3)."""

import reference_data as rd


# ---------------------------------------------------------------------------
# Loader-level tests (direct, no Flask)
# ---------------------------------------------------------------------------

def test_attribute_categories():
    ac = rd.attribute_categories()
    assert "Network activity" in ac["categories"]
    assert "ip-dst" in ac["category_type_mappings"]["Network activity"]
    # sane_defaults drive the to_ids default hint in the attribute_field editor
    assert isinstance(ac["sane_defaults"], dict)


def test_object_templates_index_and_relations():
    templates = rd.list_object_templates()
    assert len(templates) > 300
    first = templates[0]
    for key in ("uuid", "name", "version", "meta_category", "n_attributes"):
        assert key in first
    # The canonical 'file' object exists and its relations load, ui-priority sorted desc.
    file_obj = next(t for t in templates if t["name"] == "file")
    full = rd.get_object_template(file_obj["uuid"])
    assert full is not None
    assert full["relations"]
    prios = [r["ui_priority"] for r in full["relations"]]
    assert prios == sorted(prios, reverse=True)
    assert {"object_relation", "misp_attribute"} <= set(full["relations"][0])


def test_object_template_unknown_uuid():
    assert rd.get_object_template("00000000-0000-0000-0000-000000000000") is None


def test_taxonomies_and_tag_expansion():
    taxes = rd.list_taxonomies()
    assert any(t["namespace"] == "tlp" for t in taxes)
    # tlp predicates ARE the leaf tags (no value groups)
    tlp_tags = [t["tag"] for t in rd.get_taxonomy_tags("tlp")]
    assert "tlp:red" in tlp_tags
    assert "tlp:amber" in tlp_tags
    # a valued taxonomy expands to namespace:predicate="value"
    adm = [t["tag"] for t in rd.get_taxonomy_tags("admiralty-scale")]
    assert any(tag.startswith('admiralty-scale:source-reliability="') for tag in adm)


def test_taxonomy_unknown_namespace():
    assert rd.get_taxonomy_tags("no-such-taxonomy") == []


def test_galaxy_types_and_clusters():
    types = rd.list_galaxy_types()
    assert any(g["type"] == "threat-actor" for g in types)
    clusters = rd.get_galaxy_clusters("threat-actor")
    assert len(clusters) > 100
    assert all("value" in c for c in clusters)


def test_galaxy_clusters_unknown_type():
    assert rd.get_galaxy_clusters("no-such-galaxy-type") == []


# ---------------------------------------------------------------------------
# API-level tests (via Flask test client)
# ---------------------------------------------------------------------------

def test_api_describe_types(client):
    res = client.get("/api/describe-types")
    assert res.status_code == 200
    data = res.get_json()
    assert "categories" in data and "category_type_mappings" in data


def test_api_attribute_categories(client):
    res = client.get("/api/attribute-categories")
    assert res.status_code == 200
    assert "category_type_mappings" in res.get_json()


def test_api_object_templates(client):
    res = client.get("/api/object-templates")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list) and len(data) > 300
    # detail endpoint
    detail = client.get(f"/api/object-templates/{data[0]['uuid']}")
    assert detail.status_code == 200
    assert "relations" in detail.get_json()
    # 404 on unknown
    assert client.get("/api/object-templates/deadbeef").status_code == 404


def test_api_taxonomies(client):
    res = client.get("/api/taxonomies")
    assert res.status_code == 200
    assert any(t["namespace"] == "tlp" for t in res.get_json())
    tags = client.get("/api/taxonomies/tlp")
    assert tags.status_code == 200
    assert "tlp:red" in [t["tag"] for t in tags.get_json()["tags"]]
    assert client.get("/api/taxonomies/no-such-ns").status_code == 404


def test_api_galaxies(client):
    res = client.get("/api/galaxy-types")
    assert res.status_code == 200
    assert any(g["type"] == "threat-actor" for g in res.get_json())
    clusters = client.get("/api/galaxy-clusters?type=threat-actor")
    assert clusters.status_code == 200
    assert len(clusters.get_json()["clusters"]) > 100
    # missing type param
    assert client.get("/api/galaxy-clusters").status_code == 400
