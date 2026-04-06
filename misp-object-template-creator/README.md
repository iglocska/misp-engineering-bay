# MISP Object Template Creator

A web application and REST API for creating, editing, validating, and exporting [MISP object template](https://www.misp-project.org/objects.html) definitions. Eliminates the need to manually craft JSON files by providing a guided, schema-aware authoring experience.

## Features

- **Visual editor** with guided attribute builder, searchable type dropdowns, and category filtering driven by MISP's `describeTypes.json`
- **Real-time validation** — errors and warnings displayed as you type
- **Template browser** — explore all 388+ existing MISP object templates, load any of them for editing or clone as a starting point
- **REST API** — full CRUD for programmatic template management
- **Live JSON preview** — see the output `definition.json` update in real-time
- **Import/export** — upload, paste, or download `definition.json` files
- **Light/dark theme** with persistent toggle
- **Swagger UI** at `/docs` for interactive API documentation

## Prerequisites

- Python 3.10+
- The `misp-objects` submodule checked out (included in this repo)

## Quick Start

```bash
# Clone the repo (with submodules)
git clone --recurse-submodules <repo-url>
cd misp-engineering-bay/misp-object-template-creator

# Run (creates venv, installs deps, starts server)
./run.sh
```

The app starts at **http://127.0.0.1:5050**.

### Manual Setup

```bash
cd misp-object-template-creator

# Create virtual environment
python3 -m venv venv

# Install dependencies
./venv/bin/pip install -r requirements.txt

# Start the server
./venv/bin/python app.py
```

## Configuration

All settings can be overridden via environment variables:

Copy the default configuration file and edit as needed:

```bash
cp config.json.default config.json
```

`config.json` is git-ignored so your local settings won't be committed. Available options:

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `"public"` | `"public"` — save to output/ only. `"private"` — also allows persisting directly to the misp-objects repo. |

Environment variables override `config.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `public` | Same as `config.json` `mode` |
| `MISP_OBJECTS_PATH` | `../misp-objects` | Path to the misp-objects repository |
| `OUTPUT_PATH` | `./output` | Where user-created templates are saved |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `5050` | Bind port |
| `DEBUG` | `1` | Enable Flask debug mode (`1` or `0`) |

Example:

```bash
PORT=8080 HOST=0.0.0.0 ./run.sh
```

## Usage

### Web UI

- **/** — Template editor. Create new templates or load/clone existing ones.
- **/browse** — Browse all existing MISP object templates with search and filtering.
- **/docs** — Interactive Swagger UI for the REST API.

#### Creating a Template

1. Fill in the template metadata (name, description, meta-category).
2. Add attributes using the "+ Add Attribute" button. For each attribute:
   - Set the **Object relation** (the key name, e.g. `src-ip`, `filename`, `score`)
   - Select a **MISP type** (e.g. `ip-src`, `text`, `float`) — note that the relation name can differ from the type
   - Fill in the description, UI priority, and optional flags
   - Select category overrides if needed (filtered to valid categories for the chosen type)
3. Configure requirements (required attributes and/or required-one-of).
4. Review the live JSON preview and validation status.
5. Click **Save Template** or **Export JSON**.

#### Loading an Existing Template

Click **Load Existing** to search and load any of the 388+ templates from the misp-objects repository. Choose between:
- **Load for editing** — modify the template in place (keeps UUID)
- **Clone as new template** — use it as a starting point with a fresh UUID

### REST API

Base URL: `http://127.0.0.1:5050/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/describe-types` | Full MISP type system data |
| `GET` | `/api/meta-categories` | Valid meta-categories |
| `GET` | `/api/types` | All MISP attribute types with metadata |
| `GET` | `/api/types/<type>/categories` | Valid categories for a type |
| `GET` | `/api/templates` | List all templates (filterable by `name`, `meta-category`) |
| `GET` | `/api/templates/<name>` | Get a specific template |
| `POST` | `/api/templates` | Create a new template |
| `PUT` | `/api/templates/<name>` | Update a template |
| `DELETE` | `/api/templates/<name>` | Delete a user-created template |
| `POST` | `/api/templates/validate` | Validate without saving |
| `GET` | `/api/uuid` | Generate a new UUIDv4 |

See `/docs` for the full OpenAPI specification with request/response examples.

## Running Tests

```bash
./venv/bin/python -m pytest tests/ -v
```

## Project Structure

```
misp-object-template-creator/
├── app.py                 # Flask application and API routes
├── config.py              # Configuration
├── describe_types.py      # describeTypes.json loader and lookups
├── validator.py           # Template validation engine
├── template_store.py      # Template file I/O
├── run.sh                 # Quick-start script (creates venv, runs app)
├── requirements.txt       # Python dependencies
├── data/
│   └── describeTypes.json # Bundled MISP type definitions (update via CI)
├── static/
│   ├── css/style.css      # Application styles (light + dark themes)
│   ├── js/                # Editor, preview, and type-helper scripts
│   └── openapi.json       # OpenAPI 3.0 specification
├── templates/             # Jinja2 HTML templates
├── tests/                 # API test suite
└── output/                # User-created templates (git-ignored)
```

## Updating describeTypes.json

The bundled `data/describeTypes.json` is a snapshot of MISP's canonical type definitions. To update it:

```bash
curl -o data/describeTypes.json \
  https://raw.githubusercontent.com/MISP/MISP/refs/heads/2.5/describeTypes.json
```

This will be automated via CI in the future.

## License

See the repository root for license information.
