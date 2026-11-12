"""
storage.py -- Offline-first cache layer for the MCDM hub.

Design (per the project Main Idea):
  * The Raspberry Pi hub pulls NASA POWER daily data for the farm location
    and SoilGrids soil properties, and stores them LOCALLY.
  * A background thread refreshes the NASA data every 24 hours; every
    decision-support feature keeps working from the cache when the hub is
    offline (farmers have no internet).

Storage = SQLite (stdlib sqlite3), one table per dataset with JSON blobs
keyed by (dataset, lat, lon). Simple, crash-safe, zero dependencies.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "data", "cache")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "cache.sqlite3")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.execute(
            "CREATE TABLE IF NOT EXISTS cache ("
            " dataset TEXT, lat REAL, lon REAL, fetched TEXT,"
            " payload TEXT, PRIMARY KEY (dataset, lat, lon))")
        _conn.commit()
    return _conn


def get(dataset: str, lat: float, lon: float, max_age_h: float = 24.0
        ) -> dict | None:
    with _lock:
        row = _connect().execute(
            "SELECT fetched, payload FROM cache WHERE dataset=? AND lat=? AND lon=?",
            (dataset, round(lat, 3), round(lon, 3))).fetchone()
    if not row:
        return None
    fetched = dt.datetime.fromisoformat(row[0])
    age = dt.datetime.now() - fetched
    if age > dt.timedelta(hours=max_age_h):
        return None
    return {"fetched": row[0], "payload": json.loads(row[1]), "age_hours": age.total_seconds()/3600.0}


def put(dataset: str, lat: float, lon: float, payload: dict) -> None:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT OR REPLACE INTO cache (dataset, lat, lon, fetched, payload)"
            " VALUES (?,?,?,?,?)",
            (dataset, round(lat, 3), round(lon, 3),
             dt.datetime.now().isoformat(), json.dumps(payload)))
        c.commit()


def status() -> list[dict]:
    with _lock:
        rows = _connect().execute(
            "SELECT dataset, lat, lon, fetched FROM cache").fetchall()
    return [{"dataset": r[0], "lat": r[1], "lon": r[2], "fetched": r[3]}
            for r in rows]
