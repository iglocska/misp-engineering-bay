#!/usr/bin/env bash
# Fetch the latest versions of all vendored JS/CSS libraries.
# Run this before each release to ensure bundled libraries are up to date.
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Updating vendored libraries ==="

# ---------------------------------------------------------------------------
# Swagger UI (used by all three tools)
# ---------------------------------------------------------------------------
SWAGGER_VERSION=$(curl -sL "https://registry.npmjs.org/swagger-ui-dist/latest" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
echo ""
echo "Swagger UI: v${SWAGGER_VERSION}"

for tool in misp-object-template-creator misp-galaxy-editor misp-event-template-editor; do
    dir="$REPO_ROOT/$tool/static/vendor"
    mkdir -p "$dir"
    echo "  -> $tool"
    curl -sL -o "$dir/swagger-ui-bundle.js" "https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js"
    curl -sL -o "$dir/swagger-ui.css"       "https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css"
done

# ---------------------------------------------------------------------------
# JSZip (used by galaxy editor)
# ---------------------------------------------------------------------------
JSZIP_VERSION=$(curl -sL "https://registry.npmjs.org/jszip/latest" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
echo ""
echo "JSZip: v${JSZIP_VERSION}"

dir="$REPO_ROOT/misp-galaxy-editor/static/vendor"
mkdir -p "$dir"
echo "  -> misp-galaxy-editor"
curl -sL -o "$dir/jszip.min.js" "https://unpkg.com/jszip@${JSZIP_VERSION}/dist/jszip.min.js"

# ---------------------------------------------------------------------------
echo ""
echo "Done. Verify changes with: git diff --stat"
