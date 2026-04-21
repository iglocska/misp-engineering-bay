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

The service binds to `0.0.0.0:5050` by default (2 workers) so it's reachable from other hosts on the network. The application has no built-in authentication — put it behind a firewall, VPN, or a reverse proxy if you don't want it world-accessible. To restrict to loopback or change port/workers, override at install time:

```bash
HOST=127.0.0.1 PORT=5050 WORKERS=4 ./install-service.sh
```

**Manage the service** (still as the `misp-engineering-bay` user):

```bash
systemctl --user status  misp-object-template-creator
systemctl --user restart misp-object-template-creator
systemctl --user stop    misp-object-template-creator
journalctl   --user -u   misp-object-template-creator -f
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
    "cert_file": "/etc/ssl/certs/misp-object-template-creator.crt",
    "key_file":  "/etc/ssl/private/misp-object-template-creator.key"
  }
}
```

Then restart the service to pick up the change:

```bash
systemctl --user restart misp-object-template-creator
```

Verify:

```bash
ss -ltnp | grep 5050              # gunicorn still listening
curl -kI https://<host>:5050/     # -k accepts self-signed during the smoke test
```

If the cert or key paths are wrong or unreadable, the service will fail to start — check `journalctl --user -u misp-object-template-creator -n 50` for the exact error.

Caveats:

- **Readability.** Both files must be readable by the `misp-engineering-bay` user. `/etc/ssl/private` is typically root-only; either relocate the key to a path that user can read (e.g. `/home/misp-engineering-bay/tls/`), or grant access with `setfacl -m u:misp-engineering-bay:r /etc/ssl/private/misp-object-template-creator.key`.
- **Privileged ports.** A user service cannot bind to ports below 1024. Keep the port at 5050 (or any high port), or use Option 2 / a reverse proxy to terminate on :443.
- **Renewal.** You're responsible for rotating the cert and running `systemctl --user restart misp-object-template-creator` afterwards — gunicorn won't pick up a new cert without a reload.

#### Option 2 — Automatic Let's Encrypt via Caddy (reverse proxy)

Use this when you have a public DNS name pointing at the host and want certificates issued and renewed automatically. Caddy is the simplest route — it provisions and auto-renews LE certs out of the box. In this setup gunicorn keeps serving HTTP on loopback and Caddy handles TLS on :443.

**Prerequisites:** a public DNS `A`/`AAAA` record pointing at the host, and ports `80` + `443` reachable from the internet (LE uses HTTP-01 challenges by default).

**Step 1 — Bind the service to loopback only** (Caddy becomes the public entrypoint; binding to `0.0.0.0` would expose gunicorn directly alongside it):

```bash
HOST=127.0.0.1 PORT=5050 ./install-service.sh
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
object-template-creator.example.com {
    reverse_proxy 127.0.0.1:5050
}
```

Replace `object-template-creator.example.com` with your actual hostname. Reload Caddy:

```bash
sudo systemctl reload caddy
```

On the first HTTPS request Caddy will obtain a Let's Encrypt certificate and auto-renew it thereafter (certs live under `/var/lib/caddy/.local/share/caddy/certificates/`).

Verify:

```bash
curl -I https://object-template-creator.example.com/
```

If issuance fails, check `sudo journalctl -u caddy -n 100`. Common causes are DNS not yet propagated, port 80/443 blocked by a firewall, or LE rate limits (use the staging CA while iterating: add `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` to the Caddy site block).

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
| `https.enabled` | `false` | When `true`, the systemd service serves HTTPS. See [Enabling HTTPS](#enabling-https). |
| `https.cert_file` | `""` | Absolute path to the PEM certificate (required when `https.enabled` is `true`). |
| `https.key_file` | `""` | Absolute path to the PEM private key (required when `https.enabled` is `true`). |

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
├── gunicorn.conf.py       # Gunicorn config (reads TLS settings from config.json)
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
