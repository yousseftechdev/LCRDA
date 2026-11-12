#!/usr/bin/env bash
# run.sh -- start the hub from the venv (foreground). For "keep it running"
# use the systemd service instead (see scripts/install.sh).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"
[ -x venv/bin/python ] || { echo "venv missing -- run scripts/install.sh first"; exit 1; }
exec ./venv/bin/python run.py "$@"
