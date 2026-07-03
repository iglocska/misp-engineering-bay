"""Validation engine for MISP event templates (PRD §8).

Two layers, both run offline:
  Layer 1 — Structural: validate the `definition` document against the library
            schema shipped in the misp-event-templates submodule
            (schema_event_template.json — the CI gate).
  Layer 2 — Semantic: cross-element + reference-data checks (task 2.2).

`validate_template()` returns a ValidationResult; `errors` block export/persist
(PRD D8), `warnings` are advisory.
"""

from __future__ import annotations

import json
import re

import jsonschema

import config
import reference_data
from describe_types import get_describe_types

_FIELD_REF_RE = re.compile(r"\{\{field:([a-zA-Z_][a-zA-Z0-9_]*)\}\}")


class ValidationResult:
    def __init__(self):
        self.errors: list[dict] = []
        self.warnings: list[dict] = []

    @property
    def valid(self) -> bool:
        return len(self.errors) == 0

    def add_error(self, path: str, message: str):
        self.errors.append({"path": path, "message": message, "severity": "error"})

    def add_warning(self, path: str, message: str):
        self.warnings.append({"path": path, "message": message, "severity": "warning"})

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Schema loading (cached for the process lifetime)
# ---------------------------------------------------------------------------

_schema: dict | None = None


def load_schema() -> dict:
    global _schema
    if _schema is None:
        with open(config.SCHEMA_EVENT_TEMPLATE_PATH, encoding="utf-8") as f:
            _schema = json.load(f)
    return _schema


# ---------------------------------------------------------------------------
# Layer 1 — structural
# ---------------------------------------------------------------------------

# The library schema names each element subschema element_<type> and pins its
# `type` via a const, so a structure element can match at most one branch of the
# top-level `oneOf`. When it matches none, jsonschema reports an unhelpful
# whole-element echo ("... is not valid under any of the given schemas"); we
# dispatch on the element's type to report the real field-level problem instead.
_KNOWN_ELEMENT_TYPES = {
    "section", "text_block", "attribute_field", "object_field", "tag_field",
    "galaxy_field", "file_field", "event_report", "object_reference",
}


def validate_structure(definition: dict) -> list[tuple[str, str]]:
    """Return a list of (json_path, message) structural errors; empty = valid."""
    schema = load_schema()
    # Enable format checking so `format: uuid` is enforced (the library CI checks
    # uuid validity separately via uuidparse; enforcing it here surfaces it inline).
    validator = jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker())
    errors: list[tuple[str, str]] = []
    for err in sorted(validator.iter_errors(definition), key=lambda e: list(e.path)):
        typed = _explain_element_oneof(definition, err)
        if typed is not None:
            errors.extend(typed)
            continue
        path = err.json_path if getattr(err, "json_path", None) else "$"
        errors.append((path, err.message))
    return errors


def _explain_element_oneof(definition: dict, err) -> list[tuple[str, str]] | None:
    """Turn the top-level `oneOf` failure on a structure element into friendly,
    field-anchored (json_path, message) tuples by re-validating the element
    against just its typed subschema (element_<type>). Returns None when `err`
    isn't that case (the caller keeps the raw error)."""
    if err.validator != "oneOf":
        return None
    ap = list(err.absolute_path)
    if len(ap) != 2 or ap[0] != "structure" or not isinstance(ap[1], int):
        return None
    idx = ap[1]
    structure = definition.get("structure")
    if not isinstance(structure, list) or idx >= len(structure) or not isinstance(structure[idx], dict):
        return None
    el = structure[idx]
    etype = el.get("type")
    if etype not in _KNOWN_ELEMENT_TYPES:
        return None  # unknown/missing type — the generic message is as good as any

    schema = load_schema()
    base = "definitions" if "definitions" in schema else "$defs"
    subschema = {"$ref": f"#/{base}/element_{etype}", base: schema.get(base, {})}
    sub = jsonschema.Draft7Validator(subschema, format_checker=jsonschema.FormatChecker())

    eid = el.get("id") or "?"
    prefix = f'{etype} "{eid}": '
    out: list[tuple[str, str]] = []
    for e in sorted(sub.iter_errors(el), key=lambda e: list(e.path)):
        leaf = "".join(f".{p}" if isinstance(p, str) else f"[{p}]" for p in e.absolute_path)
        path = f"$.structure[{idx}]{leaf}"
        field = e.absolute_path[-1] if e.absolute_path else None
        if e.validator == "minLength":
            out.append((path, f'{prefix}"{field}" must not be empty'))
        else:
            out.append((path, f"{prefix}{e.message}"))
    # Rare oneOf "matched more than one" case (element satisfies its own
    # subschema): nothing to explain — fall back to the raw message.
    return out or None


# ---------------------------------------------------------------------------
# Layer 2 — semantic (DB-free; all checks resolve against bundled reference data)
# ---------------------------------------------------------------------------

def validate_semantic(definition: dict) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Return (errors, warnings) as lists of (json_path, message).

    Checks (PRD §8): duplicate ids · object_reference endpoints resolve to
    object_field ids · attribute_field category+type is a valid MISP combo ·
    object_field template installed at version >= minimum_version ·
    info_template {{field:id}} refs resolve · authors-empty warning.
    """
    errors: list[tuple[str, str]] = []
    warnings: list[tuple[str, str]] = []

    structure = definition.get("structure")
    if not isinstance(structure, list):
        return errors, warnings  # structural layer already flagged this

    dt = get_describe_types()

    # First pass: collect ids, detect duplicates, index object_field ids.
    all_ids: list[str] = []
    seen: set[str] = set()
    object_field_ids: set[str] = set()
    for i, el in enumerate(structure):
        if not isinstance(el, dict):
            continue
        eid = el.get("id")
        if eid:
            if eid in seen:
                errors.append((f"$.structure[{i}].id", f"duplicate element id: {eid}"))
            else:
                seen.add(eid)
                all_ids.append(eid)
        if el.get("type") == "object_field" and eid:
            object_field_ids.add(eid)

    # Second pass: per-element cross-reference + reference-data checks.
    for i, el in enumerate(structure):
        if not isinstance(el, dict):
            continue
        etype = el.get("type")
        eid = el.get("id", "?")

        if etype == "attribute_field":
            misp = el.get("misp") if isinstance(el.get("misp"), dict) else {}
            category, attr_type = misp.get("category"), misp.get("type")
            if category and attr_type and not dt.is_category_valid_for_type(category, attr_type):
                errors.append((
                    f"$.structure[{i}].misp",
                    f'attribute_field "{eid}": type "{attr_type}" is not valid in category "{category}"',
                ))

        elif etype == "object_field":
            ot = el.get("object_template") if isinstance(el.get("object_template"), dict) else {}
            uuid, min_v = ot.get("uuid"), ot.get("minimum_version")
            if uuid and min_v is not None:
                installed = reference_data.object_template_version(uuid)
                if installed is None:
                    errors.append((
                        f"$.structure[{i}].object_template",
                        f'object_field "{eid}": object template {uuid} is not installed in misp-objects',
                    ))
                elif installed < int(min_v):
                    errors.append((
                        f"$.structure[{i}].object_template",
                        f'object_field "{eid}": object template {uuid} at version >= {min_v} '
                        f"is not available (misp-objects ships version {installed})",
                    ))

        elif etype == "object_reference":
            for endpoint in ("from", "to"):
                ref = el.get(endpoint)
                if ref and ref not in object_field_ids:
                    errors.append((
                        f"$.structure[{i}].{endpoint}",
                        f'object_reference {endpoint} "{ref}" does not point to an object_field in this template',
                    ))

    # info_template {{field:<id>}} references must resolve to element ids.
    info = (definition.get("event_defaults") or {}).get("info_template")
    if isinstance(info, str) and info:
        for ref in sorted(set(_FIELD_REF_RE.findall(info))):
            if ref not in all_ids:
                errors.append((
                    "$.event_defaults.info_template",
                    f"info_template references unknown field id: {ref}",
                ))

    # Library review checklist (PRD D9): warn (not block) if no authors yet.
    lm = definition.get("library_metadata") if isinstance(definition.get("library_metadata"), dict) else {}
    if not (lm.get("authors") or []):
        warnings.append((
            "$.library_metadata.authors",
            "library_metadata.authors is empty — the library review checklist expects "
            "at least one author before this template is persisted",
        ))

    return errors, warnings


# ---------------------------------------------------------------------------
# Library uniqueness (slug/name/uuid) — needs save/persist context, so it lives
# beside the validator but is called from the store (task 2.3), not from
# validate_template (the bare definition carries no slug).
# ---------------------------------------------------------------------------

def check_uniqueness(definition: dict, slug: str, others: list[dict],
                     exclude_slug: str | None = None) -> list[tuple[str, str]]:
    """Errors for slug / name / uuid collisions against `others`
    (list of {slug, name, uuid}). `exclude_slug` is the on-disk slug being
    updated in place, if any (so editing a template does not collide with itself)."""
    errors: list[tuple[str, str]] = []
    my_uuid = definition.get("uuid")
    my_name = definition.get("name")
    for o in others:
        if exclude_slug is not None and o.get("slug") == exclude_slug:
            continue
        if slug and o.get("slug") == slug:
            errors.append(("$.slug", f"slug '{slug}' already exists in the library/output"))
        if my_name and o.get("name") == my_name:
            errors.append(("$.name", f"name '{my_name}' already exists (must be unique across the catalogue)"))
        if my_uuid and o.get("uuid") == my_uuid:
            errors.append(("$.uuid", f"uuid '{my_uuid}' already exists (must be unique across the catalogue)"))
    return errors


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def validate_template(definition: dict) -> ValidationResult:
    """Full definition validation: structural (Layer 1) + semantic (Layer 2).
    Slug/name/uuid uniqueness is checked separately at save/persist time."""
    result = ValidationResult()

    if not isinstance(definition, dict):
        result.add_error("$", "Template definition must be a JSON object")
        return result

    for path, message in validate_structure(definition):
        result.add_error(path, message)

    errors, warnings = validate_semantic(definition)
    for path, message in errors:
        result.add_error(path, message)
    for path, message in warnings:
        result.add_warning(path, message)

    return result
