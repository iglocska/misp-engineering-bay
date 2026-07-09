import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
_CONFIG_DEFAULT = os.path.join(BASE_DIR, "config.json.default")
_defaults = {"mode": "public"}
_file_config = {}
for _path in (_CONFIG_FILE, _CONFIG_DEFAULT):
    if os.path.isfile(_path):
        with open(_path, encoding="utf-8") as _f:
            _file_config = json.load(_f)
        break

def _cfg(key: str) -> str:
    env_key = key.upper().replace("-", "_")
    if env_key in os.environ:
        return os.environ[env_key]
    if key in _file_config:
        return str(_file_config[key])
    return _defaults.get(key, "")

MODE = _cfg("mode").lower()
if MODE not in ("public", "private"):
    MODE = "public"

OUTPUT_PATH = os.environ.get("OUTPUT_PATH", os.path.join(BASE_DIR, "output"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5053"))
DEBUG = os.environ.get("DEBUG", "1") == "1"
