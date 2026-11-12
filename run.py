#!/usr/bin/env python3
"""MCDM Crop Rotation Decision-Aid Hub -- entry point.

Run on the Raspberry Pi 4 (or any machine):
    python3 run.py [--port 8000]
Then open http://<pi-ip>:8000 from any phone/laptop on the local network.
Only dependency: numpy (pip install numpy). No internet required after the
first NASA/SoilGrids fetch (24-hour local cache).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.server import serve  # noqa: E402

if __name__ == "__main__":
    port = 8000
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    serve(port=port)
