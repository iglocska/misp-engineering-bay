"""MISP Event Template Editor — Flask application.

Scaffold (PRD task 1.2). UI routes + /api/config are live; the reference-data,
validation, and CRUD endpoints are filled in by later phases.
"""

from flask import Flask, jsonify, render_template, request

import config
import reference_data
import validator
from describe_types import get_describe_types

app = Flask(__name__)


# ---------------------------------------------------------------------------
# UI routes
# ---------------------------------------------------------------------------

@app.route("/")
def editor():
    return render_template("editor.html", mode=config.MODE)


@app.route("/browse")
def browse():
    return render_template("browser.html")


@app.route("/docs")
def docs():
    return render_template("swagger.html")


# ---------------------------------------------------------------------------
# API — configuration
# ---------------------------------------------------------------------------

@app.route("/api/config")
def api_config():
    """Expose non-sensitive configuration to the UI."""
    return jsonify({"mode": config.MODE})


# ---------------------------------------------------------------------------
# API — reference data (offline, from bundled submodules; PRD D1)
# ---------------------------------------------------------------------------

@app.route("/api/describe-types")
def api_describe_types():
    return jsonify(get_describe_types().to_dict())


@app.route("/api/attribute-categories")
def api_attribute_categories():
    """category -> [types] map + per-type sane defaults for attribute_field editing."""
    return jsonify(reference_data.attribute_categories())


@app.route("/api/object-templates")
def api_object_templates():
    return jsonify(reference_data.list_object_templates())


@app.route("/api/object-templates/<uuid>")
def api_object_template(uuid: str):
    tmpl = reference_data.get_object_template(uuid)
    if tmpl is None:
        return jsonify({"error": f"Object template '{uuid}' not found"}), 404
    return jsonify(tmpl)


@app.route("/api/taxonomies")
def api_taxonomies():
    return jsonify(reference_data.list_taxonomies())


@app.route("/api/taxonomies/<namespace>")
def api_taxonomy_tags(namespace: str):
    if namespace not in {t["namespace"] for t in reference_data.list_taxonomies()}:
        return jsonify({"error": f"Taxonomy '{namespace}' not found"}), 404
    return jsonify({"namespace": namespace, "tags": reference_data.get_taxonomy_tags(namespace)})


@app.route("/api/galaxy-types")
def api_galaxy_types():
    return jsonify(reference_data.list_galaxy_types())


@app.route("/api/galaxy-clusters")
def api_galaxy_clusters():
    galaxy_type = request.args.get("type", "")
    if not galaxy_type:
        return jsonify({"error": "Query parameter 'type' is required"}), 400
    return jsonify({
        "type": galaxy_type,
        "clusters": reference_data.get_galaxy_clusters(galaxy_type),
    })


# ---------------------------------------------------------------------------
# API — validation (draft-permissive; always 200, errors in the body; PRD D8)
# ---------------------------------------------------------------------------

@app.route("/api/templates/validate", methods=["POST"])
def api_validate_template():
    definition = request.get_json(silent=True)
    if definition is None:
        return jsonify({"error": "Request body must be valid JSON"}), 400
    return jsonify(validator.validate_template(definition).to_dict())


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
