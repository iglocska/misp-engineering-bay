"""Read/write event templates: the bundled library, user drafts, and (private
mode) direct persistence into the misp-event-templates submodule (PRD task 2.3).

Canonical output is byte-identical to the library's `jq -S .` canonicalisation
(sorted keys, 2-space indent, raw UTF-8, trailing newline) — verified against
every bundled template — so anything persisted survives `validate_all.sh` with a
clean `jq_all_the_things.sh` diff. Files are written non-executable (the library
CI strips the +x bit).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import uuid as uuid_mod

import config
import reference_data

# Library slugs are lowercase-hyphenated directory names (CONTRIBUTE.md).
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def validate_slug(slug: str) -> None:
    """Raise ValueError if a slug is not a safe lowercase-hyphenated directory name."""
    if not slug:
        raise ValueError("Slug must not be empty")
    if not SLUG_RE.match(slug):
        raise ValueError(
            f"Slug '{slug}' is invalid. Use lowercase letters, digits and hyphens "
            "only (no leading/trailing hyphen, e.g. 'spearphishing-email')."
        )


def canonical_dumps(definition: dict) -> str:
    """Canonical JSON string, byte-identical to `jq -S .` + trailing newline.
    Strips editor-internal keys (those starting with '_')."""
    clean = {k: v for k, v in definition.items() if not k.startswith("_")}
    return json.dumps(clean, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _output_dir() -> str:
    os.makedirs(config.OUTPUT_PATH, exist_ok=True)
    return config.OUTPUT_PATH


def _library_dir() -> str:
    return config.LIBRARY_TEMPLATES_DIR


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------

def _scan(directory: str, source: str) -> list[dict]:
    results: list[dict] = []
    if not os.path.isdir(directory):
        return results
    for slug in sorted(os.listdir(directory)):
        defn = os.path.join(directory, slug, "definition.json")
        if not os.path.isfile(defn):
            continue
        try:
            with open(defn, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        lm = data.get("library_metadata") or {}
        results.append({
            "slug": slug,
            "name": data.get("name", slug),
            "uuid": data.get("uuid", ""),
            "description": data.get("description", ""),
            "tags": lm.get("tags", []),
            "misp_default": bool(data.get("misp_default", False)),
            "element_count": len(data.get("structure", []) or []),
            "source": source,
        })
    return results


def list_library_templates() -> list[dict]:
    return _scan(_library_dir(), source="library")


def list_user_templates() -> list[dict]:
    return _scan(config.OUTPUT_PATH, source="user")


def list_all_templates() -> list[dict]:
    """Library + user drafts; a user draft shadows a library template of the same slug."""
    library = list_library_templates()
    user = list_user_templates()
    user_slugs = {t["slug"] for t in user}
    merged = [t for t in library if t["slug"] not in user_slugs] + user
    merged.sort(key=lambda t: t["name"].lower())
    return merged


def catalogue_others() -> list[dict]:
    """{slug, name, uuid} for every known template (library + user), for
    uniqueness checks. User drafts shadow same-slug library entries."""
    by_slug: dict[str, dict] = {}
    for t in list_library_templates() + list_user_templates():
        by_slug[t["slug"]] = {"slug": t["slug"], "name": t["name"], "uuid": t["uuid"]}
    return list(by_slug.values())


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

def get_template(slug: str) -> dict | None:
    """Load a definition by slug. User draft first, then the bundled library."""
    validate_slug(slug)
    for directory, source in ((config.OUTPUT_PATH, "user"), (_library_dir(), "library")):
        path = os.path.join(directory, slug, "definition.json")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            data["_source"] = source
            data["_slug"] = slug
            return data
    return None


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------

def _write(slug: str, directory: str, definition: dict) -> str:
    validate_slug(slug)
    out_dir = os.path.join(directory, slug)
    # Path-traversal guard: the resolved dir must stay under `directory`.
    real_parent = os.path.realpath(directory)
    real_out = os.path.realpath(out_dir)
    if real_out != real_parent and not real_out.startswith(real_parent + os.sep):
        raise ValueError("Invalid slug: path traversal detected")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "definition.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(canonical_dumps(definition))
    os.chmod(path, 0o644)  # library CI refuses executable JSON
    return path


def save_template(slug: str, definition: dict) -> str:
    """Save a draft to the output directory (permissive; may be an in-progress doc)."""
    return _write(slug, _output_dir(), definition)


def persist_template(slug: str, definition: dict) -> str:
    """Persist directly into the misp-event-templates submodule (private mode only)."""
    if config.MODE != "private":
        raise RuntimeError("Persist to repository is only available in private mode")
    return _write(slug, _library_dir(), definition)


def delete_template(slug: str) -> bool:
    """Delete a user draft. Returns True if removed, False if not present in output."""
    validate_slug(slug)
    out_dir = os.path.join(config.OUTPUT_PATH, slug)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
        return True
    return False


def template_exists_in_library(slug: str) -> bool:
    return os.path.isfile(os.path.join(_library_dir(), slug, "definition.json"))


def template_exists_in_output(slug: str) -> bool:
    return os.path.isfile(os.path.join(config.OUTPUT_PATH, slug, "definition.json"))


def generate_uuid() -> str:
    return str(uuid_mod.uuid4())
