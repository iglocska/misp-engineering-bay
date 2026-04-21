"""Gunicorn runtime configuration.

Reads the same config.json as the Flask app to pick up TLS settings, so HTTPS
can be enabled/disabled by editing a single file and restarting the service —
no need to re-run install-service.sh.

Expected schema in config.json:

    {
      "https": {
        "enabled": true,
        "cert_file": "/path/to/cert.pem",
        "key_file":  "/path/to/key.pem"
      }
    }

Falls back to config.json.default if config.json is missing (matches config.py).
"""
import json
import os
import sys

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_CONFIG_PATH = os.path.join(_BASE_DIR, "config.json")
_DEFAULT_PATH = os.path.join(_BASE_DIR, "config.json.default")

_config: dict = {}
for _path in (_CONFIG_PATH, _DEFAULT_PATH):
    if os.path.isfile(_path):
        with open(_path) as _f:
            _config = json.load(_f)
        break

_https = _config.get("https") or {}
if _https.get("enabled"):
    _cert = _https.get("cert_file") or ""
    _key = _https.get("key_file") or ""
    if not _cert or not _key:
        sys.stderr.write(
            "gunicorn.conf.py: https.enabled is true but cert_file/key_file "
            "are missing in config.json\n"
        )
        sys.exit(1)
    if not os.path.isfile(_cert):
        sys.stderr.write(f"gunicorn.conf.py: cert_file not found: {_cert}\n")
        sys.exit(1)
    if not os.path.isfile(_key):
        sys.stderr.write(f"gunicorn.conf.py: key_file not found: {_key}\n")
        sys.exit(1)
    certfile = _cert
    keyfile = _key
