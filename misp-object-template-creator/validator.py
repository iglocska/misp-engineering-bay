"""Validation engine for MISP object templates."""

from __future__ import annotations

import json
import re
import uuid as uuid_mod

import jsonschema

import config
from describe_types import DescribeTypes, get_describe_types

# Valid meta-categories are sourced from the authoritative misp-objects
# schema_objects.json at import time so this list can never drift from
# upstream (previously it was hand-copied and fell behind when upstream
# added new categories such as "transport"). The list below is only a
# fallback for when the misp-objects submodule isn't checked out.
_META_CATEGORIES_FALLBACK = [
    "file", "network", "financial", "marine", "transport", "misc", "mobile",
    "internal", "vulnerability", "climate", "iot", "health",
    "followthemoney", "detection",
]


def _load_meta_categories() -> list[str]:
    """Read the meta-category enum from the official schema, if available."""
    try:
        with open(config.SCHEMA_OBJECTS_PATH) as f:
            schema = json.load(f)
        enum = schema["properties"]["meta-category"]["enum"]
        if isinstance(enum, list) and enum:
            return enum
    except (OSError, KeyError, ValueError, TypeError):
        pass
    return _META_CATEGORIES_FALLBACK


META_CATEGORIES = _load_meta_categories()

# Template names: alphanumeric and hyphens only (case-insensitive).
NAME_VALID_RE = re.compile(r"^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$")
# Preferred: all-lowercase
NAME_LOWERCASE_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


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


def validate_template(template: dict, dt: DescribeTypes | None = None) -> ValidationResult:
    """Validate a MISP object template dict. Returns structured errors/warnings."""
    if dt is None:
        dt = get_describe_types()

    result = ValidationResult()

    # -- Template-level checks --

    name = template.get("name")
    if not name or not isinstance(name, str):
        result.add_error("name", "Name is required and must be a non-empty string.")
    elif not NAME_VALID_RE.match(name):
        result.add_error("name", "Name must contain only alphanumeric characters and hyphens (e.g. 'my-object').")
    elif not NAME_LOWERCASE_RE.match(name):
        result.add_warning("name", "Recommended format is all-lowercase (e.g. 'my-object').")

    desc = template.get("description")
    if not desc or not isinstance(desc, str):
        result.add_error("description", "Description is required and must be a non-empty string.")

    meta_cat = template.get("meta-category")
    if not meta_cat:
        result.add_error("meta-category", "Meta-category is required.")
    elif meta_cat not in META_CATEGORIES:
        result.add_error(
            "meta-category",
            f"Invalid meta-category '{meta_cat}'. Must be one of: {', '.join(META_CATEGORIES)}",
        )

    uid = template.get("uuid")
    if not uid or not isinstance(uid, str):
        result.add_error("uuid", "UUID is required.")
    else:
        try:
            uuid_mod.UUID(uid)
        except ValueError:
            result.add_error("uuid", "UUID is not a valid UUID.")

    version = template.get("version")
    if version is None:
        result.add_error("version", "Version is required.")
    elif not isinstance(version, int) or version < 1:
        result.add_error("version", "Version must be a positive integer.")

    # -- Attributes --

    attributes = template.get("attributes")
    if not attributes or not isinstance(attributes, dict):
        result.add_error("attributes", "At least one attribute must be defined.")
        return result  # Can't validate further without attributes

    attr_names = set(attributes.keys())

    for attr_name, attr_def in attributes.items():
        prefix = f"attributes.{attr_name}"

        if not isinstance(attr_def, dict):
            result.add_error(prefix, "Attribute definition must be an object.")
            continue

        # misp-attribute (required)
        misp_attr = attr_def.get("misp-attribute")
        if not misp_attr or not isinstance(misp_attr, str):
            result.add_error(f"{prefix}.misp-attribute", "MISP attribute type is required.")
        elif not dt.is_valid_type(misp_attr):
            result.add_error(
                f"{prefix}.misp-attribute",
                f"'{misp_attr}' is not a valid MISP attribute type.",
            )

        # ui-priority (required)
        ui_pri = attr_def.get("ui-priority")
        if ui_pri is None:
            result.add_error(f"{prefix}.ui-priority", "UI priority is required.")
        elif not isinstance(ui_pri, (int, float)):
            result.add_error(f"{prefix}.ui-priority", "UI priority must be a number.")

        # description (required per schema, but warn gracefully for empty)
        attr_desc = attr_def.get("description")
        if attr_desc is None:
            result.add_error(f"{prefix}.description", "Description is required.")
        elif not isinstance(attr_desc, str):
            result.add_error(f"{prefix}.description", "Description must be a string.")
        elif not attr_desc.strip():
            result.add_warning(f"{prefix}.description", "Description is empty. Consider adding a meaningful description.")

        # categories (optional, but must be valid if present)
        cats = attr_def.get("categories")
        if cats is not None:
            if not isinstance(cats, list):
                result.add_error(f"{prefix}.categories", "Categories must be an array.")
            else:
                for i, cat in enumerate(cats):
                    if not dt.is_valid_category(cat):
                        result.add_error(
                            f"{prefix}.categories[{i}]",
                            f"'{cat}' is not a valid category.",
                        )
                    elif misp_attr and dt.is_valid_type(misp_attr) and not dt.is_category_valid_for_type(cat, misp_attr):
                        result.add_warning(
                            f"{prefix}.categories[{i}]",
                            f"'{cat}' is not in the default category set for type '{misp_attr}' per describeTypes.json.",
                        )
                if len(cats) != len(set(cats)):
                    result.add_error(f"{prefix}.categories", "Categories must not contain duplicates.")

        # Boolean flags
        for flag in ("disable_correlation", "multiple", "recommended", "to_ids"):
            val = attr_def.get(flag)
            if val is not None and not isinstance(val, bool):
                result.add_error(f"{prefix}.{flag}", f"'{flag}' must be a boolean.")

        # sane_default
        sd = attr_def.get("sane_default")
        if sd is not None:
            if not isinstance(sd, list):
                result.add_error(f"{prefix}.sane_default", "sane_default must be an array.")
            elif len(sd) != len(set(sd)):
                result.add_error(f"{prefix}.sane_default", "sane_default must not contain duplicates.")

        # values_list
        vl = attr_def.get("values_list")
        if vl is not None:
            if not isinstance(vl, list):
                result.add_error(f"{prefix}.values_list", "values_list must be an array.")
            elif len(vl) != len(set(vl)):
                result.add_error(f"{prefix}.values_list", "values_list must not contain duplicates.")

    # -- required / requiredOneOf references --

    required = template.get("required")
    if required is not None:
        if not isinstance(required, list):
            result.add_error("required", "required must be an array.")
        else:
            for i, r in enumerate(required):
                if r not in attr_names:
                    result.add_error(f"required[{i}]", f"'{r}' is not a defined attribute.")
            if len(required) != len(set(required)):
                result.add_error("required", "required must not contain duplicates.")

    required_one_of = template.get("requiredOneOf")
    if required_one_of is not None:
        if not isinstance(required_one_of, list):
            result.add_error("requiredOneOf", "requiredOneOf must be an array.")
        else:
            for i, r in enumerate(required_one_of):
                if r not in attr_names:
                    result.add_error(f"requiredOneOf[{i}]", f"'{r}' is not a defined attribute.")
            if len(required_one_of) != len(set(required_one_of)):
                result.add_error("requiredOneOf", "requiredOneOf must not contain duplicates.")

    # -- Warnings --

    if required is None and required_one_of is None:
        result.add_warning(
            "required",
            "No 'required' or 'requiredOneOf' specified. Objects of this type will have no mandatory attributes.",
        )

    if attributes and all(
        attr_def.get("ui-priority", 0) == 0
        for attr_def in attributes.values()
        if isinstance(attr_def, dict)
    ):
        result.add_warning(
            "attributes",
            "All attributes have ui-priority 0. Consider setting higher values for primary attributes.",
        )

    return result


def validate_against_schema(template: dict) -> list[str]:
    """Validate against the official schema_objects.json. Returns list of error strings."""
    schema_path = config.SCHEMA_OBJECTS_PATH
    try:
        with open(schema_path) as f:
            schema = json.load(f)
    except FileNotFoundError:
        return [f"Schema file not found at {schema_path}"]

    errors = []
    v = jsonschema.Draft7Validator(schema)
    for error in v.iter_errors(template):
        path = ".".join(str(p) for p in error.absolute_path) or "(root)"
        errors.append(f"{path}: {error.message}")
    return errors
