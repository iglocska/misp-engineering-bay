import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Load settings from config.json (not exposed via API/UI)
# ---------------------------------------------------------------------------

# config.json is git-ignored. Copy config.json.default to config.json to customise.
_CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
_CONFIG_DEFAULT = os.path.join(BASE_DIR, "config.json.default")

_defaults = {
    "mode": "public",  # "public" or "private"
}

_file_config = {}
for _path in (_CONFIG_FILE, _CONFIG_DEFAULT):
    if os.path.isfile(_path):
        with open(_path) as _f:
            _file_config = json.load(_f)
        break


def _cfg(key: str) -> str:
    """Resolve a config value: env var > config.json > default."""
    env_key = key.upper().replace("-", "_")
    if env_key in os.environ:
        return os.environ[env_key]
    if key in _file_config:
        return str(_file_config[key])
    return _defaults.get(key, "")


# ---------------------------------------------------------------------------
# Mode: "public" (default) or "private"
#   public  — save to output/ only
#   private — also allows persisting directly to the misp-event-templates repo
# ---------------------------------------------------------------------------

MODE = _cfg("mode").lower()
if MODE not in ("public", "private"):
    MODE = "public"

# Reference-data submodules (offline; see PRD D1). Paths resolve to the sibling
# submodule checkouts at the engineering-bay repo root.
MISP_EVENT_TEMPLATES_PATH = os.environ.get(
    "MISP_EVENT_TEMPLATES_PATH",
    os.path.join(BASE_DIR, "..", "misp-event-templates"),
)
MISP_OBJECTS_PATH = os.environ.get(
    "MISP_OBJECTS_PATH",
    os.path.join(BASE_DIR, "..", "misp-objects"),
)
MISP_GALAXY_PATH = os.environ.get(
    "MISP_GALAXY_PATH",
    os.path.join(BASE_DIR, "..", "misp-galaxy"),
)
MISP_TAXONOMIES_PATH = os.environ.get(
    "MISP_TAXONOMIES_PATH",
    os.path.join(BASE_DIR, "..", "misp-taxonomies"),
)

# Local describeTypes.json (bundled snapshot; updated via CI/maintainer script)
DESCRIBE_TYPES_PATH = os.path.join(BASE_DIR, "data", "describeTypes.json")

# The library schema every definition.json validates against (the CI gate).
SCHEMA_EVENT_TEMPLATE_PATH = os.path.join(
    MISP_EVENT_TEMPLATES_PATH, "schema_event_template.json"
)

# Per-template directory inside the library submodule (templates/<slug>/definition.json)
LIBRARY_TEMPLATES_DIR = os.path.join(MISP_EVENT_TEMPLATES_PATH, "templates")

# Where user-created templates are saved (public mode output)
OUTPUT_PATH = os.environ.get(
    "OUTPUT_PATH",
    os.path.join(BASE_DIR, "output"),
)

# Flask settings
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5052"))
DEBUG = os.environ.get("DEBUG", "1") == "1"
