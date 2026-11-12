#!/usr/bin/env bash
# install.sh -- one-time setup for the Live Crop Rotation Decision Aid.
# Creates the Python virtual environment, installs numpy, and (optionally)
# installs the systemd service so the hub keeps running and refreshes the
# NASA satellite data every 24 hours on its own.
#
#   sudo bash scripts/install.sh            # system-wide service (Raspberry Pi)
#   bash scripts/install.sh --user          # user service, no sudo needed
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

echo "* Creating virtual environment (venv/) ..."
python3 -m venv venv
echo "* Installing requirements (numpy) ..."
./venv/bin/pip install --quiet -r requirements.txt
./venv/bin/python -c "import numpy; print(f'* numpy {numpy.__version__} OK in venv')"

MODE="${1:-}"
if [ "$MODE" = "--user" ]; then
  UNIT_DIR="$HOME/.config/systemd/system"
  mkdir -p "$UNIT_DIR"
  sed -e "s|__ROOT__|$ROOT|g" -e "s|__USER__|$USER|g" \
      systemd/lcrda.service > "$UNIT_DIR/lcrda.service"
  systemctl --user daemon-reload
  systemctl --user enable --now lcrda.service
  echo "* Service installed (user mode): systemctl --user status lcrda"
else
  UNIT_DIR="/etc/systemd/system"
  sed -e "s|__ROOT__|$ROOT|g" systemd/lcrda.service | \
      sudo tee "$UNIT_DIR/lcrda.service" > /dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now lcrda.service
  echo "* Service installed (system mode): sudo systemctl status lcrda"
fi

echo "* Done. The hub serves http://<this-machine-ip>:8000/ on your LAN."
