#!/usr/bin/env bash
# pi wrapper: always runs pi inside a Docker sbx sandbox for the current directory.
# The unsandboxed npm binary is intentionally shadowed by this script.
set -euo pipefail

if [ "$(realpath "$PWD")" = "$(realpath "$HOME")" ]; then
  echo "pi: refusing to run in your home directory — cd into a project directory first." >&2
  exit 1
fi

if ! command -v sbx >/dev/null 2>&1; then
  echo "pi: sbx is not installed yet; pi only runs inside a sandbox (never directly on the host)." >&2
  exit 1
fi

exec sbx run --kit "$HOME/.config/pi-sbx/kit" pi -- "$@"
