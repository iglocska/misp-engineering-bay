#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Create venv if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Copy default config if no local config exists
if [ ! -f "$SCRIPT_DIR/config.json" ] && [ -f "$SCRIPT_DIR/config.json.default" ]; then
    cp "$SCRIPT_DIR/config.json.default" "$SCRIPT_DIR/config.json"
    echo "Created config.json from config.json.default — edit it to change settings."
fi

# Install/update dependencies
"$VENV_DIR/bin/pip" install -q -r "$SCRIPT_DIR/requirements.txt"

# Run the app
exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/app.py" "$@"
