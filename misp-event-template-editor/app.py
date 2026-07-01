"""MISP Event Template Editor — Flask application.

Scaffold (PRD task 1.2). UI routes + /api/config are live; the reference-data,
validation, and CRUD endpoints are filled in by later phases.
"""

from flask import Flask, jsonify, render_template

import config

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

if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
