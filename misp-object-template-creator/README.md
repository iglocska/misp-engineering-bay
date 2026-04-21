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
# Clone the repo with submodules (required — schema files live in misp-objects/)
git clone --recurse-submodules https://github.com/MISP/misp-engineering-bay.git
cd misp-engineering-bay/misp-object-template-creator

# If you cloned without --recurse-submodules, fetch them now:
# git submodule update --init --recursive

# run.sh creates the venv, installs deps, copies config.json.default →
# config.json if missing, and starts the dev server in the foreground.
./run.sh
```

The app starts at **http://127.0.0.1:5050**.

`run.sh` is for interactive/dev use — it runs Flask's dev server and dies when your shell exits. For a persistent deployment see [Running as a Service](#running-as-a-service-recommended) below.

### Manual Setup

If you prefer to do each step yourself instead of using `run.sh`:

```bash
# From the repo root, make sure submodules are present
git submodule update --init --recursive

cd misp-object-template-creator

# Create virtual environment and install dependencies
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# Create your local config from the defaults (optional — config.py falls back
# to config.json.default if config.json is missing, but copying it lets you
# customise settings without touching a tracked file)
cp config.json.default config.json

# Start the server
./venv/bin/python app.py
```

### Running as a Service (recommended)

`run.sh` is fine for development but runs Flask's dev server in the foreground — closing your terminal (or an SSH session) kills the process. For anything longer-lived, install it as a **systemd user service** backed by gunicorn.

> **Important:** do not run the installation below as your personal account. Create a dedicated service user first (Step 1), switch to it (Step 2), and run the clone + install as that user (Step 3).

**Step 1 — Create the service user (one-time, from any account with sudo):**

```bash
sudo useradd --create-home --shell /bin/bash misp-engineering-bay
sudo loginctl enable-linger misp-engineering-bay
```

`enable-linger` keeps that account's systemd user manager running regardless of whether anyone is logged in. Without it `systemctl --user` fails with `Failed to connect to bus: No medium found` and the service would stop the moment the install shell exits.

**Step 2 — Become the service user** with a proper user session (so `XDG_RUNTIME_DIR` is set and the user bus is reachable). Pick whichever works on your host:

| Method | Command |
|--------|---------|
| SSH directly (recommended) | copy your public key into `/home/misp-engineering-bay/.ssh/authorized_keys`, then `ssh misp-engineering-bay@<host>` |
| `machinectl` | `sudo machinectl shell misp-engineering-bay@` |
| `sudo` fallback | `sudo -iu misp-engineering-bay env XDG_RUNTIME_DIR=/run/user/$(id -u misp-engineering-bay) bash -l` |

Verify before continuing: `systemctl --user show-environment` should print output, not an error.

**Step 3 — Clone and install as the service user:**

```bash
git clone --recurse-submodules https://github.com/MISP/misp-engineering-bay.git
cd misp-engineering-bay/misp-object-template-creator
./install-service.sh
```

This will:
- Create the venv and install dependencies (including `gunicorn`) if needed
- Render `systemd/misp-object-template-creator.service.template` with the current install path
- Drop it into `~/.config/systemd/user/misp-object-template-creator.service`
- `daemon-reload`, `enable`, and `start` the service

The service binds to `127.0.0.1:5050` by default (2 workers). Override via env vars at install time:

```bash
HOST=0.0.0.0 PORT=5050 WORKERS=4 ./install-service.sh
```

**Manage the service** (still as the `misp-engineering-bay` user):

```bash
systemctl --user status  misp-object-template-creator
systemctl --user restart misp-object-template-creator
systemctl --user stop    misp-object-template-creator
journalctl   --user -u   misp-object-template-creator -f
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
├── install-service.sh     # Install as a systemd user service (gunicorn)
├── systemd/               # Service unit template
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
