"""Offline reference-data loaders for the event template editor (PRD D1, task 1.3).

All data comes from the bundled submodules — no live MISP is contacted:
  - attribute categories/types   -> data/describeTypes.json (via describe_types.py)
  - object templates + relations -> ../misp-objects/objects/<name>/definition.json
  - taxonomies (tag machine tags) -> ../misp-taxonomies/<ns>/machinetag.json
  - galaxy types + clusters      -> ../misp-galaxy/{galaxies,clusters}/<name>.json

Each index is scanned once and cached for the process lifetime. Loaders degrade
gracefully (return empty) when a submodule checkout is missing.
"""

from __future__ import annotations

import json
import os

import config
from describe_types import get_describe_types

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


# ---------------------------------------------------------------------------
# Attribute categories / types (describeTypes.json)
# ---------------------------------------------------------------------------

def attribute_categories() -> dict:
    """category -> [types] mapping plus per-type sane defaults, for the
    attribute_field editor's dependent dropdowns and the category+type check."""
    dt = get_describe_types()
    return {
        "categories": dt.categories,
        "category_type_mappings": dt.category_type_mappings,
        "sane_defaults": dt.sane_defaults,
    }


# ---------------------------------------------------------------------------
# Object templates (misp-objects submodule)
# ---------------------------------------------------------------------------

_object_index: dict[str, dict] | None = None


def _build_object_index() -> dict[str, dict]:
    index: dict[str, dict] = {}
    objects_dir = os.path.join(config.MISP_OBJECTS_PATH, "objects")
    if not os.path.isdir(objects_dir):
        return index
    for entry in sorted(os.listdir(objects_dir)):
        defn = os.path.join(objects_dir, entry, "definition.json")
        data = _read_json(defn)
        if not isinstance(data, dict):
            continue
        uuid = data.get("uuid")
        if not uuid:
            continue
        index[uuid] = {
            "uuid": uuid,
            "name": data.get("name", entry),
            "dir": entry,
            "version": int(data.get("version", 0) or 0),
            "meta_category": data.get("meta-category", ""),
            "description": data.get("description", ""),
            "n_attributes": len(data.get("attributes", {}) or {}),
            "_path": defn,
        }
    return index


def _objects() -> dict[str, dict]:
    global _object_index
    if _object_index is None:
        _object_index = _build_object_index()
    return _object_index


def list_object_templates() -> list[dict]:
    """Summary list for the object_field picker (no relations)."""
    out = [{k: v for k, v in t.items() if not k.startswith("_")} for t in _objects().values()]
    out.sort(key=lambda t: t["name"].lower())
    return out


def get_object_template(uuid: str) -> dict | None:
    """Full object template incl. its relations, for the per-relation override list."""
    meta = _objects().get(uuid)
    if meta is None:
        return None
    data = _read_json(meta["_path"]) or {}
    relations = []
    for object_relation, spec in (data.get("attributes", {}) or {}).items():
        if not isinstance(spec, dict):
            continue
        relations.append({
            "object_relation": object_relation,
            "description": spec.get("description", ""),
            "misp_attribute": spec.get("misp-attribute", ""),
            "ui_priority": int(spec.get("ui-priority", 0) or 0),
            "multiple": bool(spec.get("multiple", False)),
            "categories": spec.get("categories", []),
        })
    relations.sort(key=lambda r: (-r["ui_priority"], r["object_relation"]))
    return {
        "uuid": uuid,
        "name": meta["name"],
        "version": meta["version"],
        "meta_category": meta["meta_category"],
        "description": meta["description"],
        "required": data.get("required", []),
        "requiredOneOf": data.get("requiredOneOf", []),
        "relations": relations,
    }


# ---------------------------------------------------------------------------
# Taxonomies (misp-taxonomies submodule)
# ---------------------------------------------------------------------------

_taxonomy_index: dict[str, dict] | None = None


def _build_taxonomy_index() -> dict[str, dict]:
    index: dict[str, dict] = {}
    root = config.MISP_TAXONOMIES_PATH
    if not os.path.isdir(root):
        return index
    for entry in sorted(os.listdir(root)):
        mt = os.path.join(root, entry, "machinetag.json")
        data = _read_json(mt)
        if not isinstance(data, dict):
            continue
        namespace = data.get("namespace", entry)
        index[namespace] = {
            "namespace": namespace,
            "description": data.get("description", ""),
            "version": data.get("version", 0),
            "n_predicates": len(data.get("predicates", []) or []),
            "_path": mt,
        }
    return index


def _taxonomies() -> dict[str, dict]:
    global _taxonomy_index
    if _taxonomy_index is None:
        _taxonomy_index = _build_taxonomy_index()
    return _taxonomy_index


def list_taxonomies() -> list[dict]:
    """Namespace summary list for the restrict_taxonomies picker."""
    out = [{k: v for k, v in t.items() if not k.startswith("_")} for t in _taxonomies().values()]
    out.sort(key=lambda t: t["namespace"].lower())
    return out


def get_taxonomy_tags(namespace: str) -> list[dict]:
    """Expand a taxonomy into concrete machine tags for the event_defaults.tags picker.

    Tag grammar (MISP triple tags):
      namespace:predicate              (predicate has no value entries)
      namespace:predicate="value"      (predicate carries value entries)
    """
    meta = _taxonomies().get(namespace)
    if meta is None:
        return []
    data = _read_json(meta["_path"]) or {}
    values_by_pred: dict[str, list] = {}
    for vg in data.get("values", []) or []:
        if isinstance(vg, dict) and vg.get("predicate"):
            values_by_pred[vg["predicate"]] = vg.get("entry", []) or []

    tags: list[dict] = []
    for p in data.get("predicates", []) or []:
        if not isinstance(p, dict):
            continue
        pred = p.get("value")
        if not pred:
            continue
        entries = values_by_pred.get(pred)
        if entries:
            for e in entries:
                if not isinstance(e, dict) or not e.get("value"):
                    continue
                tags.append({
                    "tag": f'{namespace}:{pred}="{e["value"]}"',
                    "expanded": e.get("expanded", ""),
                    "description": e.get("description", ""),
                    "colour": e.get("colour", ""),
                })
        else:
            tags.append({
                "tag": f"{namespace}:{pred}",
                "expanded": p.get("expanded", ""),
                "description": p.get("description", ""),
                "colour": p.get("colour", ""),
            })
    return tags


# ---------------------------------------------------------------------------
# Galaxies (misp-galaxy submodule)
# ---------------------------------------------------------------------------

_galaxy_index: dict[str, dict] | None = None


def _build_galaxy_index() -> dict[str, dict]:
    """type -> {name, description, file} from galaxies/*.json (clusters share the filename)."""
    index: dict[str, dict] = {}
    galaxies_dir = os.path.join(config.MISP_GALAXY_PATH, "galaxies")
    if not os.path.isdir(galaxies_dir):
        return index
    for entry in sorted(os.listdir(galaxies_dir)):
        if not entry.endswith(".json"):
            continue
        data = _read_json(os.path.join(galaxies_dir, entry))
        if not isinstance(data, dict):
            continue
        gtype = data.get("type")
        if not gtype:
            continue
        index[gtype] = {
            "type": gtype,
            "name": data.get("name", gtype),
            "description": data.get("description", ""),
            "namespace": data.get("namespace", ""),
            "_file": entry,  # clusters/<entry> holds the cluster values
        }
    return index


def _galaxies() -> dict[str, dict]:
    global _galaxy_index
    if _galaxy_index is None:
        _galaxy_index = _build_galaxy_index()
    return _galaxy_index


def list_galaxy_types() -> list[dict]:
    """Galaxy-type summary list for the restrict_galaxy_types picker."""
    out = [{k: v for k, v in t.items() if not k.startswith("_")} for t in _galaxies().values()]
    out.sort(key=lambda t: t["type"].lower())
    return out


def get_galaxy_clusters(galaxy_type: str) -> list[dict]:
    """Cluster values for a galaxy type, for the event_defaults.galaxy_clusters picker."""
    meta = _galaxies().get(galaxy_type)
    if meta is None:
        return []
    data = _read_json(os.path.join(config.MISP_GALAXY_PATH, "clusters", meta["_file"])) or {}
    clusters = []
    for v in data.get("values", []) or []:
        if not isinstance(v, dict) or not v.get("value"):
            continue
        clusters.append({
            "value": v["value"],
            "description": v.get("description", ""),
            "uuid": v.get("uuid", ""),
        })
    clusters.sort(key=lambda c: c["value"].lower())
    return clusters


# ---------------------------------------------------------------------------
# Test / reload hook
# ---------------------------------------------------------------------------

def _reset_caches() -> None:
    global _object_index, _taxonomy_index, _galaxy_index
    _object_index = _taxonomy_index = _galaxy_index = None
