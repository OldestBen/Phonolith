"""
Last.fm historical scrobble import service.

On startup, fetches the full scrobble history for the configured user and
publishes each matched play as phonolith.playback.started so EchoGraph can
persist it. Also publishes phonolith.metadata.enriched to set lastfm_playcount
on matched tracks.

Tracks are matched by normalised (lowercase, stripped) artist + title against
the local DuckDB library. Unmatched scrobbles are logged but not persisted.

After the initial import, the service polls every SYNC_INTERVAL_HOURS for new
scrobbles since the last recorded timestamp.

Configuration is read from phonolith_config.db (set via the Settings UI) with
env vars as fallback. The service subscribes to phonolith.config.changed and
phonolith.lastfm.sync so credentials and manual triggers take effect without
a container restart.
"""

import asyncio, json, os, re, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path
import duckdb, nats, requests
from loguru import logger

NATS_URL      = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR      = os.getenv("DATA_DIR", "/data")
DB_PATH       = os.path.join(DATA_DIR, "phonolith.duckdb")
STATE_DB      = os.path.join(DATA_DIR, "lastfm_state.sqlite")
CONFIG_DB     = os.path.join(DATA_DIR, "phonolith_config.db")
BATCH_PUBLISH = 50

BASE_URL = "https://ws.audioscrobbler.com/2.0/"


# ── Config helpers ─────────────────────────────────────────────────────────────

def _read_cfg_db() -> dict:
    """Read service_config table from the shared config DB."""
    try:
        c = sqlite3.connect(CONFIG_DB)
        rows = c.execute("SELECT key, value FROM service_config").fetchall()
        c.close()
        return {r[0]: r[1] for r in rows}
    except Exception:
        return {}


def load_config() -> tuple[str, str, str, int]:
    """Return (api_key, api_secret, username, interval_secs).
    Config DB overrides env vars."""
    cfg = _read_cfg_db()
    api_key  = cfg.get("lastfm.api_key")  or os.getenv("LASTFM_API_KEY",  "")
    secret   = cfg.get("lastfm.api_secret") or os.getenv("LASTFM_API_SECRET", "")
    username = cfg.get("lastfm.username") or os.getenv("LASTFM_USERNAME", "")
    interval = int(cfg.get("lastfm.sync_interval_hours") or os.getenv("LASTFM_SYNC_INTERVAL_HOURS", "6")) * 3600
    return api_key, secret, username, interval


# ── State persistence ──────────────────────────────────────────────────────────

def open_state() -> sqlite3.Connection:
    c = sqlite3.connect(STATE_DB)
    c.execute("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)")
    c.commit()
    return c

def get_state(c: sqlite3.Connection, key: str, default=None):
    row = c.execute("SELECT value FROM state WHERE key=?", [key]).fetchone()
    return row[0] if row else default

def set_state(c: sqlite3.Connection, key: str, value: str):
    c.execute("INSERT OR REPLACE INTO state VALUES (?,?)", [key, value])
    c.commit()


# ── Last.fm API ───────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", " ", s)

def fetch_page(api_key: str, username: str, page: int, from_ts: int = 0) -> dict:
    params = {
        "method": "user.getRecentTracks",
        "user": username,
        "api_key": api_key,
        "format": "json",
        "limit": 200,
        "page": page,
        "extended": 0,
    }
    if from_ts:
        params["from"] = from_ts
    try:
        r = requests.get(BASE_URL, params=params, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Last.fm API error page {page}: {e}")
        return {}


# ── Track matching ────────────────────────────────────────────────────────────

def build_index(db_path: str) -> dict[tuple, str]:
    index: dict[tuple, str] = {}
    for attempt in range(6):
        try:
            conn = duckdb.connect(db_path, read_only=True)
            rows = conn.execute(
                "SELECT id, artist, title FROM tracks WHERE artist IS NOT NULL AND title IS NOT NULL"
            ).fetchall()
            conn.close()
            for h, artist, title in rows:
                index[(_norm(artist), _norm(title))] = h
            logger.info(f"Built match index: {len(index)} tracks")
            return index
        except Exception as e:
            if attempt == 5:
                logger.error(f"Could not read DuckDB after retries: {e}")
                return {}
            time.sleep(0.2 * (attempt + 1))
    return index

def match(index: dict, artist: str, title: str) -> str | None:
    return index.get((_norm(artist), _norm(title)))


# ── Import logic ──────────────────────────────────────────────────────────────

async def _task(nc, level: str, message: str) -> None:
    """Publish a structured task event to phonolith.tasks.lastfm for the UI monitor."""
    try:
        await nc.publish(
            "phonolith.tasks.lastfm",
            json.dumps({
                "service": "lastfm",
                "level": level,
                "message": message,
                "ts": datetime.now(timezone.utc).isoformat(),
            }).encode(),
        )
    except Exception:
        pass


async def import_scrobbles(nc, api_key: str, username: str, from_ts: int = 0) -> int:
    await _task(nc, "info", f"Building library index for matching…")
    index = build_index(DB_PATH)
    if not index:
        msg = "Library index is empty — add a music source so Tremor can scan tracks first"
        logger.warning(msg)
        await _task(nc, "warning", msg)
        return from_ts

    await _task(nc, "info", f"Matched against {len(index)} library tracks. Fetching scrobbles…")

    page, total_pages = 1, 1
    newest_ts = from_ts
    published = 0
    unmatched = 0
    play_counts: dict[str, int] = {}

    while page <= total_pages:
        data = fetch_page(api_key, username, page, from_ts)
        rt = data.get("recenttracks", {})
        attr = rt.get("@attr", {})
        total_pages = int(attr.get("totalPages", 1))
        tracks = rt.get("track", [])

        for t in tracks:
            if not isinstance(t.get("date"), dict):
                continue

            artist = t.get("artist", {}).get("#text", "")
            title  = t.get("name", "")
            ts     = int(t["date"].get("uts", 0))

            if ts > newest_ts:
                newest_ts = ts

            h = match(index, artist, title)
            if not h:
                unmatched += 1
                continue

            play_counts[h] = play_counts.get(h, 0) + 1

            event = {
                "blake3_hash": h,
                "timestamp": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "source": "lastfm_import",
                "endpoint_id": None,
                "format": None,
            }
            await nc.publish("phonolith.playback.started", json.dumps(event).encode())
            published += 1

            if published % BATCH_PUBLISH == 0:
                await asyncio.sleep(0)

        if total_pages > 1:
            await _task(nc, "info", f"Page {page}/{total_pages} — {published} plays matched so far")
        logger.info(f"Last.fm import: page {page}/{total_pages} — {published} published so far")
        page += 1
        await asyncio.sleep(0.25)

    for h, count in play_counts.items():
        await nc.publish(
            "phonolith.metadata.enriched",
            json.dumps({"blake3_hash": h, "lastfm_playcount": count}).encode(),
        )

    summary = (
        f"Import complete: {published} plays matched, "
        f"{unmatched} unmatched, {len(play_counts)} unique tracks updated"
    )
    logger.info(summary)
    await _task(nc, "success", summary)
    return newest_ts


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    state = open_state()
    nc = await nats.connect(NATS_URL)

    # Signal fired by phonolith.config.changed or phonolith.lastfm.sync
    _trigger = asyncio.Event()

    async def _on_config_changed(msg):
        try:
            data = json.loads(msg.data.decode())
            changed = data.get("keys", [])
            if any(k.startswith("lastfm.") for k in changed):
                logger.info("Last.fm config changed — restarting sync loop")
                _trigger.set()
        except Exception:
            pass

    async def _on_sync_trigger(msg):
        logger.info("Manual Last.fm sync triggered")
        _trigger.set()

    await nc.subscribe("phonolith.config.changed", cb=_on_config_changed)
    await nc.subscribe("phonolith.lastfm.sync",    cb=_on_sync_trigger)

    while True:
        api_key, _, username, interval = load_config()

        if not api_key or not username:
            logger.info(
                "LASTFM_API_KEY / LASTFM_USERNAME not configured. "
                "Set them in Settings → Last.fm. Waiting for config…"
            )
            _trigger.clear()
            # Wake when config changes or every 60 s to re-check
            try:
                await asyncio.wait_for(_trigger.wait(), timeout=60)
            except asyncio.TimeoutError:
                pass
            _trigger.clear()
            continue

        logger.info(f"Last.fm sync starting for user '{username}'")
        from_ts = int(get_state(state, "last_import_ts", "0"))
        label = "initial import" if from_ts == 0 else f"incremental from {datetime.fromtimestamp(from_ts)}"
        logger.info(f"Starting {label}")
        await _task(nc, "info", f"Starting {label} for @{username}")

        newest = await import_scrobbles(nc, api_key, username, from_ts)
        if newest > from_ts:
            set_state(state, "last_import_ts", str(newest))

        logger.info(f"Next sync in {interval // 3600}h (or when manually triggered)")
        _trigger.clear()
        try:
            await asyncio.wait_for(_trigger.wait(), timeout=float(interval))
        except asyncio.TimeoutError:
            pass
        _trigger.clear()


if __name__ == "__main__":
    asyncio.run(main())
