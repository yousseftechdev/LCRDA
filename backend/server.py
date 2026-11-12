"""
server.py -- Zero-dependency HTTP server for the MCDM hub (stdlib http.server).

Serves the web UI (frontend/) and a JSON API over the local network, so a
Raspberry Pi 4 can host it with no pip installs:

    python3 run.py             -> http://<pi-ip>:8000/

API:
  GET  /api/health  (alias: /health) -> {"status":"ok", cache entries...}
  GET  /api/crops?q=maiz            -> crop search (EcoCrop DB)
  POST /api/recommend               -> full MCDM recommendation
       body: {"lat":..,"lon":..,"shortlist":["zea-mays",...] or null,
              "priorities":{"land":4,"harvest":3,"water":2,"soilnext":3,
              "market":2}          (farmer sliders 1..5; raw 1..9 keys
              climate/soil/water/yield/rotation/market also accepted),
              "prev_crop":"zea-mays" or null,
              "water_available_mm":300 or null (=rainfed),
              "market":{"<crop key>":0.2..1.0}}
       response echoes "waterMode" ("rain"/"irrigate"), "waterAvailableMM",
       and includes "closeCall" (runner-up when SAW/TOPSIS disagree).
  POST /api/refresh                 -> force NASA/SoilGrids refetch
  GET  /api/maptile/<layer>/<z>/<x>/<y>.<ext>
                                    -> daily NASA GIBS satellite map tile,
       cached on disk (today's imagery; offline serves the newest cached day)
"""

from __future__ import annotations

import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "frontend")

from . import app as pipeline            # noqa: E402
from .data import crops as cropdb        # noqa: E402
from .data import gibs                   # noqa: E402
from . import storage                    # noqa: E402


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ---------------- helpers ----------------
    def _json(self, obj: object, code: int = 200) -> None:
        body = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path: str) -> None:
        if path == "/":
            path = "/index.html"
        full = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip("/")))
        if not full.startswith(FRONTEND_DIR) or not os.path.isfile(full):
            self.send_error(404)
            return
        ctype = {"html": "text/html", "js": "text/javascript",
                 "css": "text/css", "svg": "image/svg+xml",
                 "png": "image/png"}.get(full.rsplit(".", 1)[-1],
                                         "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8"
                         if ctype.startswith("text") else ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------------- routes ----------------
    def _maptile(self) -> None:
        """GET /api/maptile/<layer>/<z>/<x>/<y>.<ext> -> NASA GIBS tile
        (daily imagery, disk-cached; offline serves newest cached day)."""
        parts = self.path.strip("/").split("/")
        try:
            layer, z, x = parts[2], int(parts[3]), int(parts[4])
            y, ext = parts[5].split(".")
            y = int(y)
        except (IndexError, ValueError):
            self._json({"error": "bad tile path"}, 400)
            return
        got = gibs.get_tile(layer, z, x, y)
        if got is None:
            self.send_error(404)
            return
        body, ctype = got
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/api/health") or self.path == "/health":
            self._json({"status": "ok", "cache": storage.status()})
        elif self.path.startswith("/api/maptile/"):
            self._maptile()
        elif self.path.startswith("/api/crops"):
            q = ""
            if "?" in self.path:
                q = self.path.split("q=", 1)[1].split("&")[0].replace("%20", " ")
            self._json({"crops": cropdb.search(q, limit=120)})
        elif self.path.startswith("/api/"):
            self._json({"error": "unknown endpoint"}, 404)
        else:
            self._static(self.path.split("?")[0])

    def do_POST(self) -> None:  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json({"error": "bad JSON body"}, 400)
            return

        if self.path == "/api/recommend":
            try:
                res = pipeline.recommend(
                    lat=float(body["lat"]), lon=float(body["lon"]),
                    shortlist=body.get("shortlist") or None,
                    priorities=body.get("priorities"),
                    prev_crop_key=body.get("prev_crop") or None,
                    water_available_mm=body.get("water_available_mm"),
                    market_scores=body.get("market") or {},
                    soil_depth_cm=float(body.get("soil_depth_cm", 100)),
                    altitude=float(body.get("altitude", 0)),
                    measured_ph=body.get("measured_ph"),
                    max_candidates=int(body.get("max_candidates", 60)),
                )
                self._json(res)
            except Exception as e:  # surface engine errors to the UI
                self._json({"error": f"{type(e).__name__}: {e}"}, 500)

        elif self.path == "/api/refresh":
            try:
                lat, lon = float(body["lat"]), float(body["lon"])
                # NASA fair-use: one request per 0.5-degree cell. The button
                # only forces a network call when the cache is stale (>1 h
                # for weather; soil maps change on months, >7 days); with a
                # fresh cache it just reports the stored data.
                fresh = storage.get("power_daily", lat, lon, max_age_h=1)
                if fresh and "error" in fresh["payload"]:
                    fresh = None
                climate = (pipeline.get_climate(lat, lon, force_refresh=True)
                           if not fresh
                           else fresh["payload"])
                soil_fresh = storage.get("soilgrids", lat, lon, max_age_h=24*7)
                if soil_fresh and "error" in soil_fresh["payload"]:
                    soil_fresh = None
                soil = (pipeline.get_soil(lat, lon, force_refresh=True)
                        if not soil_fresh else soil_fresh["payload"])
                self._json({"status": "refreshed" if not fresh else "cached",
                            "climate_days": len(climate.get("dates", [])),
                            "soil": soil})
            except Exception as e:
                self._json({"error": f"{type(e).__name__}: {e}"}, 500)
        else:
            self._json({"error": "unknown endpoint"}, 404)

    def log_message(self, fmt, *args):  # quieter logs
        print("[hub]", self.address_string(), fmt % args)


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def _background_refresher() -> None:
    """Every hour, re-pull NASA POWER data for every cached location whose
    copy is older than 24 h. Keeps the hub's local copy of the satellite
    record current ('stores data locally every 24 hours') without any
    farmer interaction; failures are logged and retried next hour."""
    import datetime as _dt
    import time
    while True:
        try:
            gibs.warm_hints()               # keep imagery dates fresh
            now = _dt.datetime.now()
            for entry in storage.status():
                if entry["dataset"] != "power_daily":
                    continue
                fetched = _dt.datetime.fromisoformat(entry["fetched"])
                if now - fetched >= _dt.timedelta(hours=24):
                    print(f"[hub] 24h refresh: NASA POWER for "
                          f"{entry['lat']},{entry['lon']}")
                    pipeline.get_climate(entry["lat"], entry["lon"],
                                         force_refresh=True)
            # housekeeping: drop map-imagery days older than a week
            removed = gibs.cleanup_old_tiles(keep_days=8)
            if removed:
                print(f"[hub] tile housekeeping: removed {removed} old "
                      f"imagery days")
        except Exception as e:          # never kill the daemon thread
            print(f"[hub] background refresh error: {e}")
        time.sleep(3600)


def serve(host: str = "0.0.0.0", port: int = 8000) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    import threading
    threading.Thread(target=_background_refresher, daemon=True,
                     name="nasa-24h-refresher").start()
    print(f"* MCDM Crop Rotation Hub running on http://{lan_ip()}:{port}/ "
          f"(LAN-accessible; NASA data auto-refreshes every 24 h)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n* bye")
