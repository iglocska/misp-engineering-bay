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

import jsonschema

import config


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

def validate_structure(definition: dict) -> list[tuple[str, str]]:
    """Return a list of (json_path, message) structural errors; empty = valid."""
    schema = load_schema()
    # Enable format checking so `format: uuid` is enforced (the library CI checks
    # uuid validity separately via uuidparse; enforcing it here surfaces it inline).
    validator = jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker())
    errors: list[tuple[str, str]] = []
    for err in sorted(validator.iter_errors(definition), key=lambda e: list(e.path)):
        path = err.json_path if getattr(err, "json_path", None) else "$"
        errors.append((path, err.message))
    return errors


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def validate_template(definition: dict) -> ValidationResult:
    """Full validation. For task 2.1 this is structural only; semantic checks
    (task 2.2) are layered in here without changing the call site."""
    result = ValidationResult()

    if not isinstance(definition, dict):
        result.add_error("$", "Template definition must be a JSON object")
        return result

    for path, message in validate_structure(definition):
        result.add_error(path, message)

    return result
