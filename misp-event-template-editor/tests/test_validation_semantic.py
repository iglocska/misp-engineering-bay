"""Semantic validation tests (PRD task 2.2, Layer 2)."""

import reference_data as rd
import validator


def _base(structure=None, event_defaults=None, library_metadata=None):
    d = {
        "schema_version": 1,
        "uuid": "294bf4d1-c2b2-47ed-94d4-07ef5a3730e3",
        "name": "Test template",
        "event_defaults": event_defaults or {},
        "structure": structure if structure is not None else [
            {"type": "section", "id": "s_main", "label": "Main"},
        ],
    }
    if library_metadata is not None:
        d["library_metadata"] = library_metadata
    return d


def _valid_and_invalid_combo():
    """Return (category, valid_type, invalid_type) computed from describeTypes."""
    ac = rd.attribute_categories()
    mappings = ac["category_type_mappings"]
    category = "Network activity"
    in_category = set(mappings[category])
    valid_type = mappings[category][0]
    universe = {t for types in mappings.values() for t in types}
    invalid_type = next(t for t in universe if t not in in_category)
    return category, valid_type, invalid_type


def _errmsgs(result):
    return " || ".join(e["message"] for e in result.errors)


# --- duplicate ids ---------------------------------------------------------

def test_duplicate_ids():
    d = _base(structure=[
        {"type": "section", "id": "dup", "label": "A"},
        {"type": "section", "id": "dup", "label": "B"},
    ])
    result = validator.validate_template(d)
    assert not result.valid
    assert "duplicate element id: dup" in _errmsgs(result)


# --- attribute_field category+type ----------------------------------------

def test_attribute_field_valid_combo():
    category, valid_type, _ = _valid_and_invalid_combo()
    d = _base(structure=[
        {"type": "attribute_field", "id": "a1", "label": "IP",
         "misp": {"category": category, "type": valid_type}},
    ])
    assert validator.validate_template(d).valid


def test_attribute_field_invalid_combo():
    category, _, invalid_type = _valid_and_invalid_combo()
    d = _base(structure=[
        {"type": "attribute_field", "id": "a1", "label": "Bad",
         "misp": {"category": category, "type": invalid_type}},
    ])
    result = validator.validate_template(d)
    assert not result.valid
    assert "is not valid in category" in _errmsgs(result)


# --- object_field template availability ------------------------------------

def test_object_field_available():
    obj = rd.list_object_templates()[0]
    d = _base(structure=[
        {"type": "object_field", "id": "o1", "label": "Obj",
         "object_template": {"uuid": obj["uuid"], "name": obj["name"],
                             "minimum_version": max(1, obj["version"])}},
    ])
    assert validator.validate_template(d).valid


def test_object_field_version_too_high():
    obj = rd.list_object_templates()[0]
    d = _base(structure=[
        {"type": "object_field", "id": "o1", "label": "Obj",
         "object_template": {"uuid": obj["uuid"], "name": obj["name"],
                             "minimum_version": obj["version"] + 999}},
    ])
    result = validator.validate_template(d)
    assert not result.valid
    assert "is not available" in _errmsgs(result)


def test_object_field_unknown_uuid():
    d = _base(structure=[
        {"type": "object_field", "id": "o1", "label": "Obj",
         "object_template": {"uuid": "00000000-0000-0000-0000-000000000000",
                             "name": "nope", "minimum_version": 1}},
    ])
    result = validator.validate_template(d)
    assert not result.valid
    assert "is not installed" in _errmsgs(result)


# --- object_reference endpoints -------------------------------------------

def test_object_reference_valid():
    obj = rd.list_object_templates()[0]
    ot = {"uuid": obj["uuid"], "name": obj["name"], "minimum_version": max(1, obj["version"])}
    d = _base(structure=[
        {"type": "object_field", "id": "src", "label": "Src", "object_template": ot},
        {"type": "object_field", "id": "dst", "label": "Dst", "object_template": ot},
        {"type": "object_reference", "id": "ref1", "from": "src", "to": "dst",
         "relationship_type": "related-to"},
    ])
    assert validator.validate_template(d).valid


def test_object_reference_dangling():
    obj = rd.list_object_templates()[0]
    ot = {"uuid": obj["uuid"], "name": obj["name"], "minimum_version": max(1, obj["version"])}
    d = _base(structure=[
        {"type": "object_field", "id": "src", "label": "Src", "object_template": ot},
        {"type": "object_reference", "id": "ref1", "from": "src", "to": "ghost",
         "relationship_type": "related-to"},
    ])
    result = validator.validate_template(d)
    assert not result.valid
    assert 'does not point to an object_field' in _errmsgs(result)


# --- info_template field refs ---------------------------------------------

def test_info_template_known_ref():
    d = _base(
        structure=[{"type": "attribute_field", "id": "sender", "label": "Sender",
                    "misp": {"category": "Other", "type": "comment"}}],
        event_defaults={"info_template": "Case for {{field:sender}} on {{date}}"},
    )
    assert validator.validate_template(d).valid


def test_info_template_unknown_ref():
    d = _base(event_defaults={"info_template": "Case {{field:ghost}}"})
    result = validator.validate_template(d)
    assert not result.valid
    assert "info_template references unknown field id: ghost" in _errmsgs(result)


# --- authors warning -------------------------------------------------------

def test_authors_empty_warning():
    d = _base()  # no library_metadata
    result = validator.validate_template(d)
    assert result.valid  # warning, not error
    assert any("authors is empty" in w["message"] for w in result.warnings)


def test_authors_present_no_warning():
    d = _base(library_metadata={"authors": [{"name": "MISP Project"}]})
    result = validator.validate_template(d)
    assert not any("authors is empty" in w["message"] for w in result.warnings)


# --- uniqueness ------------------------------------------------------------

def test_check_uniqueness_collisions():
    d = _base()
    others = [
        {"slug": "test-template", "name": "Test template", "uuid": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
    ]
    errs = validator.check_uniqueness(d, slug="test-template", others=others)
    joined = " || ".join(m for _, m in errs)
    assert "slug 'test-template' already exists" in joined
    assert "name 'Test template' already exists" in joined


def test_check_uniqueness_excludes_self():
    d = _base()
    others = [
        {"slug": "test-template", "name": "Test template", "uuid": d["uuid"]},
    ]
    # editing the same on-disk slug: no collision with itself
    errs = validator.check_uniqueness(d, slug="test-template", others=others,
                                      exclude_slug="test-template")
    assert errs == []


def test_check_uniqueness_uuid_clash_new_template():
    d = _base()
    others = [
        {"slug": "other-slug", "name": "Other name", "uuid": d["uuid"]},
    ]
    errs = validator.check_uniqueness(d, slug="new-slug", others=others)
    assert any("uuid" in m for _, m in errs)
