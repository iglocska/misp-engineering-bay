"""Template store tests (PRD task 2.3): canonicalisation, CRUD, persist, export."""

import glob
import json
import os
import subprocess

import pytest

import config
import template_store as store


# ---------------------------------------------------------------------------
# Canonicalisation — the load-bearing guarantee (byte-identical to `jq -S`)
# ---------------------------------------------------------------------------

def _library_defs():
    return sorted(glob.glob(os.path.join(config.LIBRARY_TEMPLATES_DIR, "*", "definition.json")))


def test_canonical_dumps_matches_jq_S():
    for path in _library_defs():
        definition = json.load(open(path, encoding="utf-8"))
        ours = store.canonical_dumps(definition)
        jq = subprocess.run(["jq", "-S", "."], stdin=open(path), capture_output=True, text=True).stdout
        assert ours == jq, f"canonicalisation drift on {os.path.basename(os.path.dirname(path))}"


def test_canonical_dumps_is_jq_stable():
    """Our output, re-run through `jq -S`, is unchanged (survives jq_all_the_things.sh)."""
    definition = json.load(open(_library_defs()[0], encoding="utf-8"))
    ours = store.canonical_dumps(definition)
    reencoded = subprocess.run(["jq", "-S", "."], input=ours, capture_output=True, text=True).stdout
    assert ours == reencoded


def test_canonical_strips_internal_keys():
    out = store.canonical_dumps({"name": "x", "_source": "user", "_slug": "x"})
    assert "_source" not in out and "_slug" not in out


# ---------------------------------------------------------------------------
# Slug validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("slug", ["spearphishing-email", "abc", "a1-b2-c3"])
def test_valid_slugs(slug):
    store.validate_slug(slug)


@pytest.mark.parametrize("slug", ["", "Bad-Case", "has space", "-lead", "trail-", "a--b", "../evil", "under_score"])
def test_invalid_slugs(slug):
    with pytest.raises(ValueError):
        store.validate_slug(slug)


# ---------------------------------------------------------------------------
# Save / load / list / delete (output drafts)
# ---------------------------------------------------------------------------

def _defn(name="My template", uuid="294bf4d1-c2b2-47ed-94d4-07ef5a3730e3"):
    return {
        "schema_version": 1, "uuid": uuid, "name": name,
        "event_defaults": {}, "structure": [{"type": "section", "id": "s", "label": "S"}],
    }


def test_save_and_get_roundtrip():
    store.save_template("my-draft", _defn())
    loaded = store.get_template("my-draft")
    assert loaded["name"] == "My template"
    assert loaded["_source"] == "user"
    # file on disk is canonical + non-executable
    path = os.path.join(config.OUTPUT_PATH, "my-draft", "definition.json")
    assert open(path, encoding="utf-8").read() == store.canonical_dumps(_defn())
    assert (os.stat(path).st_mode & 0o111) == 0


def test_list_all_includes_library_and_user_shadowing():
    lib = store.list_library_templates()
    assert len(lib) >= 5
    # a user draft with the same slug as a library template shadows it
    lib_slug = lib[0]["slug"]
    store.save_template(lib_slug, _defn(name="Shadowed"))
    merged = store.list_all_templates()
    shadow = [t for t in merged if t["slug"] == lib_slug]
    assert len(shadow) == 1 and shadow[0]["source"] == "user"


def test_delete_draft():
    store.save_template("tmp-draft", _defn())
    assert store.template_exists_in_output("tmp-draft")
    assert store.delete_template("tmp-draft") is True
    assert store.delete_template("tmp-draft") is False


def test_persist_requires_private_mode(monkeypatch):
    monkeypatch.setattr(config, "MODE", "public")
    with pytest.raises(RuntimeError):
        store.persist_template("x-slug", _defn())


def test_persist_writes_to_library(monkeypatch, tmp_path):
    lib = str(tmp_path / "library")
    os.makedirs(lib, exist_ok=True)
    monkeypatch.setattr(config, "MODE", "private")
    monkeypatch.setattr(config, "LIBRARY_TEMPLATES_DIR", lib)
    path = store.persist_template("new-one", _defn())
    assert path == os.path.join(lib, "new-one", "definition.json")
    assert os.path.isfile(path)


# ---------------------------------------------------------------------------
# API surface
# ---------------------------------------------------------------------------

def test_api_crud_flow(client):
    # create draft
    res = client.post("/api/templates", json={"slug": "api-draft", "definition": _defn()})
    assert res.status_code == 201
    # duplicate create -> 409
    assert client.post("/api/templates", json={"slug": "api-draft", "definition": _defn()}).status_code == 409
    # get
    assert client.get("/api/templates/api-draft").status_code == 200
    # list includes it
    slugs = [t["slug"] for t in client.get("/api/templates").get_json()]
    assert "api-draft" in slugs
    # update
    assert client.put("/api/templates/api-draft", json={"definition": _defn(name="Renamed")}).status_code == 200
    # delete
    assert client.delete("/api/templates/api-draft").status_code == 200
    assert client.get("/api/templates/api-draft").status_code == 404


def test_api_bad_slug(client):
    assert client.post("/api/templates", json={"slug": "Bad Slug", "definition": _defn()}).status_code == 400


def test_api_delete_library_refused(client):
    lib_slug = store.list_library_templates()[0]["slug"]
    assert client.delete(f"/api/templates/{lib_slug}").status_code == 403


def test_api_export_strict(client):
    # valid definition exports as a downloadable file
    res = client.post("/api/templates/export", json={"slug": "exp", "definition": _defn()})
    assert res.status_code == 200
    assert res.mimetype == "application/json"
    assert "attachment" in res.headers.get("Content-Disposition", "")
    assert res.get_data(as_text=True) == store.canonical_dumps(_defn())
    # invalid definition is blocked (422)
    bad = _defn()
    del bad["name"]
    assert client.post("/api/templates/export", json={"definition": bad}).status_code == 422


def test_api_persist_blocked_in_public_mode(client):
    assert client.post("/api/templates/persist", json={"slug": "x", "definition": _defn()}).status_code == 403


def test_api_persist_private_strict(client, monkeypatch, tmp_path):
    lib = str(tmp_path / "library")
    os.makedirs(lib, exist_ok=True)
    monkeypatch.setattr(config, "MODE", "private")
    monkeypatch.setattr(config, "LIBRARY_TEMPLATES_DIR", lib)
    # valid + unique -> persisted
    res = client.post("/api/templates/persist", json={"slug": "brand-new", "definition": _defn()})
    assert res.status_code == 200, res.get_json()
    assert os.path.isfile(os.path.join(lib, "brand-new", "definition.json"))
    # invalid -> 422
    bad = _defn(name="")
    assert client.post("/api/templates/persist", json={"slug": "bad-one", "definition": bad}).status_code == 422


def test_api_uuid(client):
    res = client.get("/api/uuid")
    assert res.status_code == 200
    import uuid as u
    u.UUID(res.get_json()["uuid"])  # parses
