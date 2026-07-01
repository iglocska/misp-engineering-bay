"""MISP Event Template Editor — Flask application.

Scaffold (PRD task 1.2). UI routes + /api/config are live; the reference-data,
validation, and CRUD endpoints are filled in by later phases.
"""

from flask import Flask, Response, jsonify, render_template, request

import config
import reference_data
import template_store
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
# API — template CRUD (drafts to output/), plus strict persist/export (PRD D8)
# ---------------------------------------------------------------------------

@app.route("/api/templates")
def api_list_templates():
    name_f = request.args.get("name", "").lower()
    tag_f = request.args.get("tag", "").lower()
    items = template_store.list_all_templates()
    if name_f:
        items = [t for t in items if name_f in t["name"].lower()]
    if tag_f:
        items = [t for t in items if any(tag_f in x.lower() for x in t.get("tags", []))]
    return jsonify(items)


@app.route("/api/templates/<slug>")
def api_get_template(slug: str):
    try:
        template_store.validate_slug(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    tmpl = template_store.get_template(slug)
    if tmpl is None:
        return jsonify({"error": f"Template '{slug}' not found"}), 404
    return jsonify(tmpl)


def _definition_from_body():
    body = request.get_json(silent=True) or {}
    return body.get("slug", ""), body.get("definition")


@app.route("/api/templates", methods=["POST"])
def api_create_template():
    slug, definition = _definition_from_body()
    if not isinstance(definition, dict):
        return jsonify({"error": "Body must include a 'definition' object"}), 400
    try:
        template_store.validate_slug(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if template_store.template_exists_in_output(slug):
        return jsonify({"error": f"Draft '{slug}' already exists. Use PUT to update."}), 409
    path = template_store.save_template(slug, definition)
    return jsonify({
        "message": "Draft saved", "slug": slug, "path": path,
        "validation": validator.validate_template(definition).to_dict(),
    }), 201


@app.route("/api/templates/<slug>", methods=["PUT"])
def api_update_template(slug: str):
    _, definition = _definition_from_body()
    if not isinstance(definition, dict):
        return jsonify({"error": "Body must include a 'definition' object"}), 400
    try:
        template_store.validate_slug(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    path = template_store.save_template(slug, definition)
    return jsonify({
        "message": "Draft saved", "slug": slug, "path": path,
        "validation": validator.validate_template(definition).to_dict(),
    })


@app.route("/api/templates/<slug>", methods=["DELETE"])
def api_delete_template(slug: str):
    try:
        template_store.validate_slug(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if template_store.template_exists_in_library(slug) and not template_store.template_exists_in_output(slug):
        return jsonify({"error": "Cannot delete a bundled library template"}), 403
    if template_store.delete_template(slug):
        return jsonify({"message": f"Draft '{slug}' deleted"})
    return jsonify({"error": f"Draft '{slug}' not found in output"}), 404


@app.route("/api/templates/persist", methods=["POST"])
def api_persist_template():
    """Persist directly into the misp-event-templates submodule (private mode).
    Strict gate (PRD D8): must pass validation AND slug/name/uuid uniqueness."""
    if config.MODE != "private":
        return jsonify({"error": "Persist to repository is only available in private mode"}), 403
    slug, definition = _definition_from_body()
    if not isinstance(definition, dict):
        return jsonify({"error": "Body must include a 'definition' object"}), 400
    try:
        template_store.validate_slug(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    result = validator.validate_template(definition)
    for path, message in validator.check_uniqueness(
        definition, slug, template_store.catalogue_others(), exclude_slug=slug
    ):
        result.add_error(path, message)
    if not result.valid:
        return jsonify(result.to_dict()), 422
    try:
        path = template_store.persist_template(slug, definition)
    except (RuntimeError, ValueError) as e:
        return jsonify({"error": str(e)}), 403
    return jsonify({"message": "Persisted to library", "slug": slug, "path": path, **result.to_dict()})


@app.route("/api/templates/export", methods=["POST"])
def api_export_template():
    """Return the canonical definition.json for download. Strict gate (PRD D8):
    blocked unless the definition passes validation."""
    slug, definition = _definition_from_body()
    if not isinstance(definition, dict):
        return jsonify({"error": "Body must include a 'definition' object"}), 400
    if slug:
        try:
            template_store.validate_slug(slug)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    result = validator.validate_template(definition)
    if not result.valid:
        return jsonify(result.to_dict()), 422
    payload = template_store.canonical_dumps(definition)
    fname = f"{slug}-definition.json" if slug else "definition.json"
    return Response(payload, mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.route("/api/uuid")
def api_generate_uuid():
    return jsonify({"uuid": template_store.generate_uuid()})


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
