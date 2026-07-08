"""Load and expose MISP type/category definitions from the local describeTypes.json."""

import json
import os

import config


class DescribeTypes:
    """Parsed describeTypes.json with lookup helpers."""

    def __init__(self, path: str | None = None):
        path = path or config.DESCRIBE_TYPES_PATH
        with open(path) as f:
            raw = json.load(f)

        result = raw.get("result", raw)
        self.types: list[str] = result["types"]
        self.categories: list[str] = result["categories"]
        self.category_type_mappings: dict[str, list[str]] = result["category_type_mappings"]
        self.sane_defaults: dict[str, dict] = result["sane_defaults"]

        # Reverse mapping: type -> list of valid categories
        self._type_to_categories: dict[str, list[str]] = {}
        for category, types in self.category_type_mappings.items():
            for t in types:
                self._type_to_categories.setdefault(t, []).append(category)

    def get_categories_for_type(self, misp_type: str) -> list[str]:
        """Return the list of valid categories for a given MISP attribute type."""
        return self._type_to_categories.get(misp_type, [])

    def is_valid_type(self, misp_type: str) -> bool:
        return misp_type in self.types

    def is_valid_category(self, category: str) -> bool:
        return category in self.categories

    def is_category_valid_for_type(self, category: str, misp_type: str) -> bool:
        return category in self._type_to_categories.get(misp_type, [])

    def get_default_category(self, misp_type: str) -> str | None:
        info = self.sane_defaults.get(misp_type)
        if info:
            return info.get("default_category")
        return None

    def get_default_to_ids(self, misp_type: str) -> bool:
        info = self.sane_defaults.get(misp_type)
        if info:
            return bool(info.get("to_ids", 0))
        return False

    def type_summary(self, misp_type: str) -> dict:
        """Return a summary dict for a given type (categories, defaults)."""
        return {
            "type": misp_type,
            "categories": self.get_categories_for_type(misp_type),
            "default_category": self.get_default_category(misp_type),
            "default_to_ids": self.get_default_to_ids(misp_type),
        }

    def all_types_summary(self) -> list[dict]:
        return [self.type_summary(t) for t in self.types]

    def to_dict(self) -> dict:
        """Full export for the API."""
        return {
            "types": self.types,
            "categories": self.categories,
            "category_type_mappings": self.category_type_mappings,
            "sane_defaults": self.sane_defaults,
        }


# Module-level singleton
_instance: DescribeTypes | None = None


def get_describe_types() -> DescribeTypes:
    global _instance
    if _instance is None:
        _instance = DescribeTypes()
    return _instance
