# MISP Guard Rule Builder

A Flask web application for creating, validating, and exporting [`misp-guard`](https://github.com/MISP/misp-guard) `config.json` rule files.

## Features

- Guided editing for allowlisted URLs/domains
- Compartment reachability matrix (`compartments_rules.can_reach`)
- MISP instance definitions with host, IP, port, affiliation, and compartment membership
- Taxonomy rules for required taxonomies, allowed tags, and blocked tags
- Blocking lists for distribution levels, sharing groups, attribute types, attribute categories, and object types
- Live JSON preview and API-backed validation
- Export to `misp-guard-config.json`
- Optional private-mode persistence to an output directory

## Run locally

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The app listens on `127.0.0.1:5053` by default.

## API

- `GET /api/sample` — return a starter configuration based on the upstream `config.json.dist` shape.
- `POST /api/rules/validate` — validate a candidate MISP Guard config.
- `POST /api/rules/export` — validate and return a downloadable JSON response.
- `POST /api/rules/persist` — write a validated config to `OUTPUT_PATH` when `mode` is `private`.
