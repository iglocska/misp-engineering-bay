# MISP Galaxy Editor

A web application and REST API for creating, editing, validating, and exporting [MISP galaxy](https://www.misp-project.org/galaxy.html) definitions and their associated cluster collections. Provides a guided authoring experience for both simple galaxies and matrix-style kill chain galaxies (like ATT&CK).

Each MISP galaxy consists of two paired files: a **galaxy definition** (metadata, icon, namespace, kill chain layout) and a **cluster collection** (the actual clusters — entries with names, descriptions, meta fields, and relationships). The editor treats these as a single entity — you fill in the galaxy metadata once and the cluster collection file is populated automatically.

## Features

- **Unified editor** — galaxy metadata (name, description, category, source, authors, icon, namespace) is entered once and shared across both the galaxy definition and cluster collection files
- **Cluster editor** with search, pagination, and inline editing — each cluster entry supports freeform meta fields and relationships
- **Matrix editor** with drag-and-drop for kill chain galaxies — assign clusters to phases across multiple scopes/tabs (e.g., ATT&CK matrices per platform)
- **Freeform meta editor** with autocomplete for 80+ known meta keys, supports both string and array values, and auto-merges duplicate keys into arrays
- **Relationship editor** for managing cluster-to-cluster links (50+ known relationship types)
- **Real-time validation** with live JSON preview (Galaxy / Cluster Collection tabs)
- **Galaxy browser** — explore all 112+ existing galaxies with search and filtering
- **Export as zip** — downloads a zip with `galaxies/<type>.json` and `clusters/<type>.json`, matching the misp-galaxy repository structure
- **REST API** for reading galaxies, validating bundles, and persisting changes (private mode)
- **Light/dark theme** with persistent toggle
- **Swagger UI** at `/docs` for interactive API documentation

## Prerequisites

- Python 3.10+
- The `misp-galaxy` submodule checked out (included in this repo)

## Quick Start

```bash
# Clone the repo with submodules (required — schema files live in misp-galaxy/)
git clone --recurse-submodules https://github.com/MISP/misp-engineering-bay.git
cd misp-engineering-bay/misp-galaxy-editor

# If you cloned without --recurse-submodules, fetch them now:
# git submodule update --init --recursive

# run.sh creates the venv, installs deps, copies config.json.default →
# config.json if missing, and starts the dev server in the foreground.
./run.sh
```

The app starts at **http://127.0.0.1:5051**.

`run.sh` is for interactive/dev use — it runs Flask's dev server and dies when your shell exits. For a persistent deployment see [Running as a Service](#running-as-a-service-recommended) below.

### Manual Setup

If you prefer to do each step yourself instead of using `run.sh`:

```bash
# From the repo root, make sure submodules are present
git submodule update --init --recursive

cd misp-galaxy-editor

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
cd misp-engineering-bay/misp-galaxy-editor
./install-service.sh
```

This will:
- Create the venv and install dependencies (including `gunicorn`) if needed
- Render `systemd/misp-galaxy-editor.service.template` with the current install path
- Drop it into `~/.config/systemd/user/misp-galaxy-editor.service`
- `daemon-reload`, `enable`, and `start` the service

The service binds to `127.0.0.1:5051` by default (2 workers). Override via env vars at install time:

```bash
HOST=0.0.0.0 PORT=5051 WORKERS=4 ./install-service.sh
```

**Manage the service** (still as the `misp-engineering-bay` user):

```bash
systemctl --user status  misp-galaxy-editor
systemctl --user restart misp-galaxy-editor
systemctl --user stop    misp-galaxy-editor
journalctl   --user -u   misp-galaxy-editor -f
```

## Configuration

Copy the default configuration file and edit as needed:

```bash
cp config.json.default config.json
```

`config.json` is git-ignored so your local settings won't be committed. Available options:

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `"public"` | Operating mode — see [Public vs Private Mode](#public-vs-private-mode) below. |

Environment variables override `config.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `public` | Same as `config.json` `mode` |
| `MISP_GALAXY_PATH` | `../misp-galaxy` | Path to the misp-galaxy repository |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `5051` | Bind port |
| `DEBUG` | `1` | Enable Flask debug mode (`1` or `0`) |

Example:

```bash
PORT=8080 HOST=0.0.0.0 MODE=private ./run.sh
```

### Public vs Private Mode

The editor operates in one of two modes, controlled by the `mode` setting in `config.json` or the `MODE` environment variable.

#### Public Mode (default)

Intended for general use and community-facing deployments. In this mode:

- Users can **browse**, **load**, and **edit** any existing galaxy from the misp-galaxy repository
- Users can **create new galaxies** from scratch in the editor
- The only way to get data out is via **Export Zip** (downloads a zip with `galaxies/<type>.json` and `clusters/<type>.json`) or **Copy JSON** (copies the bundle to clipboard)
- **Nothing is persisted** on the server — the editor is purely a client-side authoring tool backed by the API for validation and reading existing galaxies
- The "Persist to Repository" button is hidden

This mode is safe to expose to users who should not have write access to the misp-galaxy repository.

#### Private Mode

Intended for maintainers who want to write changes directly to their local misp-galaxy repository checkout. In this mode:

- Everything from public mode is available
- An additional **Persist to Repository** button appears in the editor, which writes the galaxy definition and cluster collection files directly into the misp-galaxy submodule (`galaxies/<type>.json` and `clusters/<type>.json`)
- The persist endpoint (`POST /api/galaxies/persist`) is active and accepts validated bundles
- Path safety checks (name validation, traversal prevention) are enforced on all write operations

To enable private mode:

```bash
# Via config.json
echo '{"mode": "private"}' > config.json

# Or via environment variable
MODE=private ./run.sh
```

## Usage

### Web UI

- **/** — Galaxy editor. Create new galaxies or load/clone existing ones.
- **/browse** — Browse all existing MISP galaxies with search and filtering.
- **/docs** — Interactive Swagger UI for the REST API.

#### Creating a Galaxy

1. Set the **Type** field (the binding key between galaxy and cluster collection, used as the filename for both).
2. Fill in the **Galaxy Definition** — name, description, category, source, authors, UUID, version, icon, namespace. These fields are shared: the cluster collection file is populated from them automatically.
3. Optionally enable **Matrix galaxy** to define kill chain scopes and phases. A default scope is created automatically — just start adding phases. Add more scopes if you need multiple tabs (e.g., per platform).
4. Add **Clusters** using the "+ Add Cluster" button. Each cluster entry gets a UUID automatically and can have a name, description, freeform meta fields, and relationships to other clusters.
5. For matrix galaxies, use **Matrix View** to drag-and-drop clusters onto kill chain phases.
6. Review the live JSON preview (Galaxy / Cluster Collection tabs) and validation status.
7. Click **Export Zip** to download the result, or **Persist to Repository** (private mode) to write directly to the misp-galaxy checkout.

#### Editing an Existing Galaxy

Click **Load Existing** in the editor or use the **Browse Galaxies** page to find a galaxy. You can:
- **Edit** — load the galaxy into the editor with auto-incremented version
- **Clone** — use the galaxy as a starting point with a fresh UUID and type

#### Matrix Editor

For galaxies with kill chain order:
- Switch between scopes using the **tab bar** (e.g., "attack-Windows", "attack-Linux")
- **Drag** clusters from the unplaced panel into matrix columns (phases)
- **Ctrl+drag** to assign a cluster to multiple phases without removing it from others
- Click a card to expand and edit the cluster inline

### REST API

Base URL: `http://127.0.0.1:5051/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Non-sensitive configuration (mode) |
| `GET` | `/api/galaxies` | List all galaxies (filterable by `name`, `namespace`, `has_kill_chain`) |
| `GET` | `/api/galaxies/<type>` | Get a galaxy bundle (galaxy + cluster collection) |
| `POST` | `/api/galaxies/validate` | Validate a bundle without persisting |
| `POST` | `/api/galaxies/persist` | Write to misp-galaxy repo (private mode only) |
| `GET` | `/api/meta-suggestions` | Reference data for autocomplete (namespaces, icons, meta keys, relationship types) |
| `GET` | `/api/uuid` | Generate a new UUIDv4 |

See `/docs` for the full OpenAPI specification with request/response examples.

## Running Tests

```bash
./venv/bin/python -m pytest tests/ -v
```

## Project Structure

```
misp-galaxy-editor/
├── app.py                 # Flask application and API routes
├── config.py              # Configuration
├── galaxy_store.py        # Galaxy+cluster file I/O (read from submodule, persist in private mode)
├── galaxy_meta.py         # Reference data (meta keys, namespaces, icons, etc.)
├── validator.py           # Bundle validation engine
├── run.sh                 # Quick-start script (creates venv, runs app)
├── install-service.sh     # Install as a systemd user service (gunicorn)
├── systemd/               # Service unit template
├── requirements.txt       # Python dependencies
├── static/
│   ├── css/style.css      # Application styles (light + dark themes)
│   ├── vendor/            # Vendored JS/CSS libraries (Swagger UI, JSZip)
│   ├── js/
│   │   ├── utils.js       # Shared utilities
│   │   ├── editor.js      # Main editor logic
│   │   ├── values-editor.js # Cluster list management
│   │   ├── meta-editor.js # Freeform key-value meta editor
│   │   ├── related-editor.js # Relationship editor
│   │   ├── matrix-editor.js # Kill chain matrix drag-and-drop
│   │   └── preview.js     # Live JSON preview + validation
│   └── openapi.json       # OpenAPI 3.0 specification
├── templates/             # Jinja2 HTML templates
└── tests/                 # API test suite
```

## License

See the repository root for license information.
