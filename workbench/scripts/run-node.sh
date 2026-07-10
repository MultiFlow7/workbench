#!/usr/bin/env bash
set -euo pipefail

if command -v node >/dev/null 2>&1; then
  exec node "$@"
fi

PNPM_BIN="$(command -v pnpm || true)"
if [ -n "$PNPM_BIN" ]; then
  PNPM_DIR="$(cd "$(dirname "$PNPM_BIN")" && pwd)"
  if [ -x "$PNPM_DIR/../node/bin/node" ]; then
    exec "$PNPM_DIR/../node/bin/node" "$@"
  fi
fi

echo "node executable not found. Install Node.js or use a pnpm runtime that bundles node." >&2
exit 127
