# MISP Event Template Editor

A web application and REST API for creating, editing, validating, previewing, and exporting [MISP event templates](https://www.misp-project.org/) — the `event-template-v1` construct. It provides a guided authoring experience for the reusable JSON documents that encode an incident-response playbook (spearphishing triage, ransomware response, credential exposure, …) as a single-page form a MISP operator fills to produce a consistently-shaped event.

The canonical artifact is a bare library `definition.json`, laid out per-template as `templates/<slug>/definition.json` in the [misp-event-templates](https://github.com/MISP/misp-event-templates) repository — mirroring how the misp-objects and misp-galaxy libraries are structured. Everything the tool exports or persists is validated offline against the same schema the library CI enforces, so authored templates pass review cleanly.

## Features

- **Guided builder** — a palette + sortable canvas + per-element properties pane covering **all 9 element types**: section, text_block, attribute_field, object_field, tag_field, galaxy_field, file_field, event_report, object_reference
- **Reference-data-backed editing, fully offline** — attribute category→type dropdowns (from `describeTypes.json`), object-template + per-relation pickers (from misp-objects), taxonomy and galaxy pickers (from misp-taxonomies / misp-galaxy) — no live MISP needed
- **Full `event_defaults` editing** — distribution (+ sharing group), threat level, analysis; a guided `info_template` builder with `{{date}}`/`{{now}}`/`{{user}}`/`{{field:<id>}}` variables; default tags (taxonomy-backed) and default galaxy clusters (galaxy-backed), each with a `locked` toggle
- **Live preview** — a canonical-JSON tab (byte-identical to what gets exported) and a read-only **user-form preview** mirroring how MISP renders the template to the operator
- **Two-layer validation** — structural (JSON Schema) + semantic (duplicate ids, dangling object references, invalid category/type combos, uninstalled object templates, unresolved `{{field:id}}` refs, slug/name uniqueness) run entirely offline
- **Draft-permissive, export/persist-strict** — editing allows work-in-progress with live inline errors; **export and persist are blocked until the document passes validation**, so nothing hitting the library can fail CI
- **Template browser** — explore the bundled library plus your drafts, filter by name/tag/source, and load, clone, or delete
- **Export / persist** — public mode downloads the canonical `definition.json`; private mode persists it directly into the misp-event-templates submodule
- **Light/dark theme** with persistent toggle
- **Swagger UI** at `/docs` for interactive API documentation

## Prerequisites

- Python 3.10+
- The `misp-event-templates`, `misp-objects`, `misp-galaxy`, and `misp-taxonomies` submodules checked out (included in this repo)

## Quick Start

```bash
# Clone the repo with submodules (required — the schema and reference data
# live in the misp-event-templates / misp-objects / misp-galaxy / misp-taxonomies submodules)
git clone --recurse-submodules https://github.com/MISP/misp-engineering-bay.git
cd misp-engineering-bay/misp-event-template-editor

# If you cloned without --recurse-submodules, fetch them now:
# git submodule update --init --recursive

# run.sh creates the venv, installs deps, copies config.json.default →
# config.json if missing, and starts the dev server in the foreground.
./run.sh
```

The app starts at **http://127.0.0.1:5052**.

`run.sh` is for interactive/dev use — it runs Flask's dev server and dies when your shell exits. For a persistent deployment see [Running as a Service](#running-as-a-service-recommended) below.

### Manual Setup

If you prefer to do each step yourself instead of using `run.sh`:

```bash
# From the repo root, make sure submodules are present
git submodule update --init --recursive

cd misp-event-template-editor

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
cd misp-engineering-bay/misp-event-template-editor
./install-service.sh
```

This will:
- Create the venv and install dependencies (including `gunicorn`) if needed
- Render `systemd/misp-event-template-editor.service.template` with the current install path
- Drop it into `~/.config/systemd/user/misp-event-template-editor.service`
- `daemon-reload`, `enable`, and `start` the service

The service binds to `0.0.0.0:5052` by default (2 workers) so it's reachable from other hosts on the network. The application has no built-in authentication — put it behind a firewall, VPN, or a reverse proxy if you don't want it world-accessible. To restrict to loopback or change port/workers, override at install time:

```bash
HOST=127.0.0.1 PORT=5052 WORKERS=4 ./install-service.sh
```

**Manage the service** (still as the `misp-engineering-bay` user):

```bash
systemctl --user status  misp-event-template-editor
systemctl --user restart misp-event-template-editor
systemctl --user stop    misp-event-template-editor
journalctl   --user -u   misp-event-template-editor -f
```

### Enabling HTTPS

The service serves plain HTTP by default. Pick one of the two options below depending on whether you already have a certificate or want one provisioned automatically.

#### Option 1 — Use an existing certificate (TLS terminated at gunicorn)

Use this when you already have a certificate + key file on disk (self-signed, corporate CA, purchased cert, a cert from your own ACME client, etc). TLS is configured in `config.json` and picked up by `gunicorn.conf.py` at service startup — no need to re-run `install-service.sh` when you enable, disable, or rotate the cert.

Edit `config.json` (created from `config.json.default` on first install) and fill in the `https` block:

```json
{
  "mode": "public",
  "https": {
    "enabled": true,
    "cert_file": "/etc/ssl/certs/misp-event-template-editor.crt",
    "key_file":  "/etc/ssl/private/misp-event-template-editor.key"
  }
}
```

Then restart the service to pick up the change:

```bash
systemctl --user restart misp-event-template-editor
```

Verify:

```bash
ss -ltnp | grep 5052              # gunicorn still listening
curl -kI https://<host>:5052/     # -k accepts self-signed during the smoke test
```

If the cert or key paths are wrong or unreadable, the service will fail to start — check `journalctl --user -u misp-event-template-editor -n 50` for the exact error.

Caveats:

- **Readability.** Both files must be readable by the `misp-engineering-bay` user. `/etc/ssl/private` is typically root-only; either relocate the key to a path that user can read (e.g. `/home/misp-engineering-bay/tls/`), or grant access with `setfacl -m u:misp-engineering-bay:r /etc/ssl/private/misp-event-template-editor.key`.
- **Privileged ports.** A user service cannot bind to ports below 1024. Keep the port at 5052 (or any high port), or use Option 2 / a reverse proxy to terminate on :443.
- **Renewal.** You're responsible for rotating the cert and running `systemctl --user restart misp-event-template-editor` afterwards — gunicorn won't pick up a new cert without a reload.

#### Option 2 — Automatic Let's Encrypt via Caddy (reverse proxy)

Use this when you have a public DNS name pointing at the host and want certificates issued and renewed automatically. Caddy is the simplest route — it provisions and auto-renews LE certs out of the box. In this setup gunicorn keeps serving HTTP on loopback and Caddy handles TLS on :443.

**Prerequisites:** a public DNS `A`/`AAAA` record pointing at the host, and ports `80` + `443` reachable from the internet (LE uses HTTP-01 challenges by default).

**Step 1 — Bind the service to loopback only** (Caddy becomes the public entrypoint; binding to `0.0.0.0` would expose gunicorn directly alongside it):

```bash
HOST=127.0.0.1 PORT=5052 ./install-service.sh
```

**Step 2 — Install Caddy** (as root, on Debian/Ubuntu — see [caddyserver.com/docs/install](https://caddyserver.com/docs/install) for other distros):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

**Step 3 — Configure the reverse proxy.** Edit `/etc/caddy/Caddyfile`:

```caddy
event-template-editor.example.com {
    reverse_proxy 127.0.0.1:5052
}
```

Replace `event-template-editor.example.com` with your actual hostname. Reload Caddy:

```bash
sudo systemctl reload caddy
```

On the first HTTPS request Caddy will obtain a Let's Encrypt certificate and auto-renew it thereafter (certs live under `/var/lib/caddy/.local/share/caddy/certificates/`).

Verify:

```bash
curl -I https://event-template-editor.example.com/
```

If issuance fails, check `sudo journalctl -u caddy -n 100`. Common causes are DNS not yet propagated, port 80/443 blocked by a firewall, or LE rate limits (use the staging CA while iterating: add `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` to the Caddy site block).

## Configuration

Copy the default configuration file and edit as needed:

```bash
cp config.json.default config.json
```

`config.json` is git-ignored so your local settings won't be committed. Available options:

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `"public"` | Operating mode — see [Public vs Private Mode](#public-vs-private-mode) below. |
| `https.enabled` | `false` | When `true`, the systemd service serves HTTPS. See [Enabling HTTPS](#enabling-https). |
| `https.cert_file` | `""` | Absolute path to the PEM certificate (required when `https.enabled` is `true`). |
| `https.key_file` | `""` | Absolute path to the PEM private key (required when `https.enabled` is `true`). |

Environment variables override `config.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `public` | Same as `config.json` `mode` |
| `MISP_EVENT_TEMPLATES_PATH` | `../misp-event-templates` | Path to the misp-event-templates repository (holds the schema + library templates + persist target) |
| `MISP_OBJECTS_PATH` | `../misp-objects` | Path to the misp-objects repository (object_field templates) |
| `MISP_GALAXY_PATH` | `../misp-galaxy` | Path to the misp-galaxy repository (galaxy types + clusters) |
| `MISP_TAXONOMIES_PATH` | `../misp-taxonomies` | Path to the misp-taxonomies repository (taxonomy tags) |
| `OUTPUT_PATH` | `./output` | Where user drafts are saved (public-mode output; git-ignored) |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `5052` | Bind port |
| `DEBUG` | `1` | Enable Flask debug mode (`1` or `0`) |

Example:

```bash
PORT=8080 HOST=0.0.0.0 MODE=private ./run.sh
```

### Public vs Private Mode

The editor operates in one of two modes, controlled by the `mode` setting in `config.json` or the `MODE` environment variable.

#### Public Mode (default)

Intended for general use and community-facing deployments. In this mode:

- Users can **browse**, **load**, **clone**, and **edit** any bundled library template, and **create new templates** from scratch
- Drafts can be **saved** to the tool's `output/` directory (server-side, git-ignored)
- The only way to get a library-ready file out is via **Export** — downloads the canonical `definition.json`, blocked until the template passes validation
- **Nothing is written to the misp-event-templates repository**
- The "Persist to library" button is hidden

This mode is safe to expose to users who should not have write access to the misp-event-templates repository.

#### Private Mode

Intended for maintainers who want to write templates directly into their local misp-event-templates checkout. In this mode:

- Everything from public mode is available
- An additional **Persist to library** button appears in the editor, which writes the canonical `templates/<slug>/definition.json` directly into the misp-event-templates submodule
- The persist endpoint (`POST /api/templates/persist`) is active and enforces the strict gate: the document must pass validation **and** slug/name/uuid uniqueness against the bundled library
- Path safety checks (slug validation, traversal prevention) are enforced on all write operations

To enable private mode:

```bash
# Via config.json
echo '{"mode": "private"}' > config.json

# Or via environment variable
MODE=private ./run.sh
```

## Usage

### Web UI

- **/** — Event template editor. Create new templates or load/clone existing ones.
- **/browse** — Browse the bundled library and your drafts, with search and filtering.
- **/docs** — Interactive Swagger UI for the REST API.

#### Creating a Template

1. Fill in the **template metadata** — name (the display title), slug (the library directory name; auto-derived from the name until you edit it), description, and the `misp_default` / `library_metadata` fields (authors, tags, compatible MISP version).
2. Set the **event defaults** — distribution, threat level, analysis; build the `info_template` with the insert-variable toolbar; add default tags and galaxy clusters.
3. Build the **structure** — add elements from the palette, drag to reorder, and edit each element's properties in the inspector. Reference-backed fields (attribute category/type, object templates and their relations, taxonomies, galaxy types) autocomplete from the bundled data.
4. Watch the **Preview** — the JSON tab shows exactly what will be exported; the Form tab shows the read-only user-facing form; the status panel shows export-readiness.
5. Click **Save draft** to store a work-in-progress in `output/`, **Export** to download the canonical `definition.json`, or **Persist to library** (private mode) to write it into the misp-event-templates checkout.

#### Editing / Cloning an Existing Template

Use the **Browse Templates** page to find a template. You can:
- **Edit** — load the template into the editor in place (keeps its slug and uuid)
- **Clone** — start from a copy with a fresh uuid and a re-derived slug, so it can't collide with the original on persist

### REST API

Base URL: `http://127.0.0.1:5052/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Non-sensitive configuration (mode) |
| `GET` | `/api/describe-types` | Full MISP type system (categories, types, mappings, defaults) |
| `GET` | `/api/attribute-categories` | Category→type mappings + sane defaults for attribute_field |
| `GET` | `/api/object-templates` | List installed object templates (for object_field) |
| `GET` | `/api/object-templates/<uuid>` | One object template with its relations |
| `GET` | `/api/taxonomies` | List taxonomy namespaces |
| `GET` | `/api/taxonomies/<namespace>` | Expanded machine tags for a taxonomy |
| `GET` | `/api/galaxy-types` | List galaxy types |
| `GET` | `/api/galaxy-clusters?type=<type>` | Cluster values for a galaxy type |
| `GET` | `/api/templates` | List library + draft templates (filterable by `name`, `tag`) |
| `GET` | `/api/templates/<slug>` | Load a template definition |
| `POST` | `/api/templates` | Create a draft (permissive) |
| `PUT` | `/api/templates/<slug>` | Update a draft (permissive) |
| `DELETE` | `/api/templates/<slug>` | Delete a draft (refuses library templates) |
| `POST` | `/api/templates/validate` | Two-layer validation (always 200; result in body) |
| `POST` | `/api/templates/export` | Download the canonical `definition.json` (strict-valid gate) |
| `POST` | `/api/templates/persist` | Write to misp-event-templates (private mode; strict-valid gate) |
| `GET` | `/api/uuid` | Generate a new UUIDv4 |

See `/docs` for the full OpenAPI specification with request/response schemas.

## Running Tests

```bash
./venv/bin/python -m pytest tests/ -v
```

## Project Structure

```
misp-event-template-editor/
├── app.py                 # Flask application and API routes
├── config.py              # Configuration (env > config.json > defaults)
├── reference_data.py      # Offline reference-data loaders (object templates, taxonomies, galaxies)
├── describe_types.py      # describeTypes.json parser (attribute categories/types)
├── validator.py           # Two-layer validation engine (structural + semantic)
├── template_store.py      # Browse/load/save/persist + canonical (jq -S) serialisation
├── run.sh                 # Quick-start script (creates venv, runs app)
├── install-service.sh     # Install as a systemd user service (gunicorn)
├── gunicorn.conf.py       # Gunicorn config (reads TLS settings from config.json)
├── systemd/               # Service unit template
├── requirements.txt       # Python dependencies
├── data/
│   └── describeTypes.json # Bundled MISP type-system snapshot
├── static/
│   ├── css/style.css      # Application styles (light + dark themes)
│   ├── vendor/            # Vendored JS/CSS libraries (Swagger UI)
│   ├── js/
│   │   ├── common.js      # Shared utilities (escaping, toasts, fetch wrappers, dotted-path)
│   │   ├── reference.js   # Client reference-data cache
│   │   ├── elements.js    # The 9 element factories + property-editor markup
│   │   ├── event-defaults.js # event_defaults panel + info_template builder + pickers
│   │   ├── preview.js     # Live canonical-JSON + read-only user-form preview
│   │   ├── editor.js      # Builder state, canvas/palette/inspector, save/export/persist
│   │   └── browse.js      # Template browser (filter/load/clone/delete)
│   └── openapi.json       # OpenAPI 3.0 specification
├── templates/             # Jinja2 HTML templates (base, editor, browser, swagger)
├── tests/                 # pytest suite (validation, store, reference data)
└── output/                # User drafts (git-ignored; public-mode target)
```

## License

See the repository root for license information.
