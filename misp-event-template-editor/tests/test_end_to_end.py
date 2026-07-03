"""End-to-end acceptance test (PRD task 8.3).

Encodes the §11 acceptance template — a non-trivial document with multiple
sections, at least one of every one of the 9 element types, and full
`event_defaults` — and drives it through the real HTTP surface:

  * POST /api/templates/validate  -> valid, no errors
  * POST /api/templates/export    -> 200, canonical bytes, download headers

plus the export strict-gate (D8) rejecting an invalid document. This locks in
the manual validate_all.sh-clean round-trip proven for 8.3 as a regression test
(no external CLI needed — it relies only on the bundled submodule pins, exactly
like test_all_library_templates_validate_clean).
"""

import json

import template_store as store

# A real installed object template (misp-objects pin) so the object_field
# semantic check (installed version >= minimum_version) resolves.
_DOMAIN_IP_UUID = "43b3b146-77eb-4931-b4cc-b66c60f28734"

ACCEPTANCE_TEMPLATE = {
    "schema_version": 1,
    "uuid": "b91d9f1a-1c2d-4e6f-8a3b-0c1d2e3f4a5b",
    "name": "Phishing triage (acceptance)",
    "description": "Acceptance template exercising every element type.",
    "misp_default": True,
    "library_metadata": {
        "compatible_misp_version": "2.5.0",
        "authors": [{"name": "Engineering Bay", "contact": "misp@example.org"}],
        "tags": ["incident-response", "phishing"],
    },
    "event_defaults": {
        "info_template": "Phishing triage — {{date}} ({{field:attachment_hash}})",
        "distribution": 1,
        "threat_level_id": 2,
        "analysis": 0,
        "tags": [
            {"name": "tlp:amber", "locked": True},
            {"name": "phishing", "locked": False},
        ],
        "galaxy_clusters": [
            {"galaxy_type": "sector", "value": "Academia - University", "locked": False},
        ],
    },
    "structure": [
        {"type": "section", "id": "sec_email", "label": "Reported email", "help": "What the user forwarded."},
        {"type": "text_block", "id": "intro", "content": "Fill in **what** was reported and **where** it landed."},
        {"type": "attribute_field", "id": "attachment_hash", "parent": "sec_email", "label": "Attachment hash",
         "mandatory": True, "misp": {"category": "Payload delivery", "type": "sha256", "to_ids_default": True}},
        {"type": "file_field", "id": "eml_file", "parent": "sec_email", "label": "Original email (.eml)", "as": "attachment"},
        {"type": "section", "id": "sec_infra", "label": "Infrastructure"},
        {"type": "object_field", "id": "sender_infra", "parent": "sec_infra", "label": "Sender infrastructure",
         "object_template": {"uuid": _DOMAIN_IP_UUID, "name": "domain-ip", "minimum_version": 1},
         "relations": [{"object_relation": "domain", "mandatory": True}, {"object_relation": "ip"}]},
        {"type": "object_field", "id": "landing_infra", "parent": "sec_infra", "label": "Landing-page infrastructure",
         "object_template": {"uuid": _DOMAIN_IP_UUID, "name": "domain-ip", "minimum_version": 1}},
        {"type": "object_reference", "id": "infra_ref", "from": "sender_infra", "to": "landing_infra",
         "relationship_type": "connects-to", "comment": "Sender infra resolves to the landing page."},
        {"type": "section", "id": "sec_assessment", "label": "Assessment"},
        {"type": "tag_field", "id": "classification", "parent": "sec_assessment", "label": "Classification",
         "restrict_taxonomies": ["tlp"], "multiple": True},
        {"type": "galaxy_field", "id": "targeted_sector", "parent": "sec_assessment", "label": "Targeted sector",
         "restrict_galaxy_types": ["sector"]},
        {"type": "event_report", "id": "summary", "parent": "sec_assessment", "label": "Analyst summary",
         "default_content": "## Summary\n\n- Vector:\n- Impact:\n- Recommendation:"},
    ],
}


def test_acceptance_template_covers_all_nine_types():
    types = {e["type"] for e in ACCEPTANCE_TEMPLATE["structure"]}
    assert types == {
        "section", "text_block", "attribute_field", "object_field", "tag_field",
        "galaxy_field", "file_field", "event_report", "object_reference",
    }
    # multiple sections + full event_defaults (the §11 shape)
    assert sum(1 for e in ACCEPTANCE_TEMPLATE["structure"] if e["type"] == "section") >= 2
    ed = ACCEPTANCE_TEMPLATE["event_defaults"]
    assert {"info_template", "distribution", "threat_level_id", "analysis", "tags", "galaxy_clusters"} <= set(ed)


def test_acceptance_template_validates_clean(client):
    res = client.post("/api/templates/validate", json=ACCEPTANCE_TEMPLATE)
    assert res.status_code == 200
    body = res.get_json()
    assert body["valid"] is True, body["errors"]
    assert body["errors"] == []
    assert body["warnings"] == []          # authors present -> no authors warning


def test_acceptance_template_exports_canonical(client):
    res = client.post("/api/templates/export",
                      json={"slug": "phishing-triage-acceptance", "definition": ACCEPTANCE_TEMPLATE})
    assert res.status_code == 200
    assert 'filename="phishing-triage-acceptance-definition.json"' in res.headers["Content-Disposition"]
    payload = res.get_data(as_text=True)
    # The download is exactly the canonical serialisation ...
    assert payload == store.canonical_dumps(ACCEPTANCE_TEMPLATE)
    # ... and re-parsing it yields the same document (round-trip stable).
    assert json.loads(payload) == json.loads(store.canonical_dumps(ACCEPTANCE_TEMPLATE))


def test_export_blocked_when_invalid(client):
    # A text_block may not carry `parent` (additionalProperties:false) — the D8
    # gate must refuse to export.
    bad = json.loads(json.dumps(ACCEPTANCE_TEMPLATE))
    bad["structure"][1]["parent"] = "sec_email"
    res = client.post("/api/templates/export", json={"slug": "bad", "definition": bad})
    assert res.status_code == 422
    body = res.get_json()
    assert body["valid"] is False
    assert any("structure[1]" in e["path"] for e in body["errors"])
