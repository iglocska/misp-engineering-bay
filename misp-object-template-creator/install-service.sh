#!/usr/bin/env bash
#
# Install the misp-object-template-creator as a systemd --user service.
#
# This renders systemd/misp-object-template-creator.service.template with the
# current install path and drops the result into ~/.config/systemd/user/. The
# service runs gunicorn against app:app, survives SSH disconnects, and
# restarts on failure.
#
# Usage:
#   ./install-service.sh                  # install with defaults
#   PORT=5050 HOST=0.0.0.0 ./install-service.sh
#   WORKERS=4 ./install-service.sh
#
# After install:
#   systemctl --user start  misp-object-template-creator
#   systemctl --user status misp-object-template-creator
#   journalctl --user -u misp-object-template-creator -f
#
# To have the service keep running after you log out:
#   sudo loginctl enable-linger "$USER"
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="misp-object-template-creator"
TEMPLATE="$SCRIPT_DIR/systemd/${SERVICE_NAME}.service.template"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/${SERVICE_NAME}.service"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-5050}"
WORKERS="${WORKERS:-2}"

if [ ! -f "$TEMPLATE" ]; then
    echo "ERROR: service template not found at $TEMPLATE" >&2
    exit 1
fi

# Make sure the venv exists and gunicorn is installed before we hand off to
# systemd — otherwise the first start will just fail and confuse the user.
if [ ! -x "$SCRIPT_DIR/venv/bin/gunicorn" ]; then
    echo "Setting up virtualenv and installing dependencies..."
    if [ ! -d "$SCRIPT_DIR/venv" ]; then
        python3 -m venv "$SCRIPT_DIR/venv"
    fi
    "$SCRIPT_DIR/venv/bin/pip" install -q -r "$SCRIPT_DIR/requirements.txt"
fi

# Seed config.json from the defaults if missing, so the user has a file to
# edit for runtime settings (mode, https, ...).
if [ ! -f "$SCRIPT_DIR/config.json" ] && [ -f "$SCRIPT_DIR/config.json.default" ]; then
    cp "$SCRIPT_DIR/config.json.default" "$SCRIPT_DIR/config.json"
    echo "Created $SCRIPT_DIR/config.json from config.json.default — edit it to enable HTTPS, change mode, etc."
fi

mkdir -p "$UNIT_DIR"

sed \
    -e "s|@INSTALL_DIR@|$SCRIPT_DIR|g" \
    -e "s|@HOST@|$HOST|g" \
    -e "s|@PORT@|$PORT|g" \
    -e "s|@WORKERS@|$WORKERS|g" \
    "$TEMPLATE" > "$UNIT_PATH"

echo "Wrote $UNIT_PATH"

# systemctl --user needs a running user manager (user@UID.service). If we're in
# an SSH session without a logind session, or on an account where linger was
# never enabled, the user bus won't exist and we'd fail with a cryptic
# "Failed to connect to bus: No medium found". Detect that up front and give
# the user something actionable.
if ! systemctl --user show-environment >/dev/null 2>&1; then
    cat >&2 <<EOF

The unit file was written, but systemctl --user can't reach your user
instance (no user bus available). This usually means one of:

  * You're running as a user that doesn't have a login session (e.g. via
    sudo -u / su), so XDG_RUNTIME_DIR and the user bus aren't set up.
  * The account has no 'linger' enabled and systemd-logind didn't create
    a session for this SSH login.

To fix it, as a user with sudo:

  sudo loginctl enable-linger "$USER"

Then log out of the SSH session and back in, and run:

  systemctl --user daemon-reload
  systemctl --user enable --now ${SERVICE_NAME}.service

EOF
    exit 1
fi

systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.service"
systemctl --user restart "${SERVICE_NAME}.service"

echo
echo "Service installed and started. Useful commands:"
echo "  systemctl --user status  $SERVICE_NAME"
echo "  systemctl --user restart $SERVICE_NAME"
echo "  systemctl --user stop    $SERVICE_NAME"
echo "  journalctl --user -u $SERVICE_NAME -f"
echo
echo "To keep the service running after logout, run once:"
echo "  sudo loginctl enable-linger \"$USER\""
