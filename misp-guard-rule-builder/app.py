"""MISP Guard Rule Builder — Flask application."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, render_template, request

import config
from validator import validate_config

app = Flask(__name__)

SAMPLE_CONFIG_PATH = os.path.join(config.BASE_DIR, "sample_config.json")


@app.route("/")
def editor():
    return render_template("editor.html", mode=config.MODE)


@app.route("/api/config")
def api_config():
    return jsonify({"mode": config.MODE})


@app.route("/api/sample")
def api_sample():
    with open(SAMPLE_CONFIG_PATH, encoding="utf-8") as sample_file:
        return jsonify(json.load(sample_file))


@app.route("/api/rules/validate", methods=["POST"])
def api_validate_rules():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Request body must be valid JSON"}), 400
    return jsonify(validate_config(data).to_dict())


@app.route("/api/rules/export", methods=["POST"])
def api_export_rules():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Request body must be valid JSON"}), 400
    result = validate_config(data)
    if not result.valid:
        return jsonify(result.to_dict()), 422
    payload = json.dumps(data, indent=2, sort_keys=True) + "\n"
    return Response(payload, mimetype="application/json", headers={"Content-Disposition": "attachment; filename=misp-guard-config.json"})


@app.route("/api/rules/persist", methods=["POST"])
def api_persist_rules():
    if config.MODE != "private":
        return jsonify({"error": "Persist is only available in private mode"}), 403
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Request body must be valid JSON"}), 400
    result = validate_config(data)
    if not result.valid:
        return jsonify(result.to_dict()), 422
    os.makedirs(config.OUTPUT_PATH, exist_ok=True)
    path = os.path.join(config.OUTPUT_PATH, f"misp-guard-config-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.json")
    with open(path, "w", encoding="utf-8") as output_file:
        json.dump(data, output_file, indent=2, sort_keys=True)
        output_file.write("\n")
    return jsonify({"message": "MISP Guard rules persisted", "path": path, **result.to_dict()})


if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
