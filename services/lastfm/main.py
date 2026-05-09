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
"""

import asyncio, json, os, re, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path
import duckdb, nats, requests
from loguru import logger

NATS_URL        = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR        = os.getenv("DATA_DIR", "/data")
DB_PATH         = os.path.join(DATA_DIR, "phonolith.duckdb")
STATE_DB        = os.path.join(DATA_DIR, "lastfm_state.sqlite")

API_KEY         = os.getenv("LASTFM_API_KEY", "")
API_SECRET      = os.getenv("LASTFM_API_SECRET", "")
USERNAME        = os.getenv("LASTFM_USERNAME", "")
SYNC_INTERVAL   = int(os.getenv("LASTFM_SYNC_INTERVAL_HOURS", "6")) * 3600
BATCH_PUBLISH   = 50   # NATS publish batch size (yield between batches)

BASE_URL = "https://ws.audioscrobbler.com/2.0/"


# ── State persistence ─────────────────────────────────────────────────────────

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
    """Normalise artist/title for fuzzy matching."""
    s = s.lower().strip()
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", " ", s)

def fetch_page(page: int, from_ts: int = 0) -> dict:
    params = {
        "method": "user.getRecentTracks",
        "user": USERNAME,
        "api_key": API_KEY,
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
    """Return dict of (norm_artist, norm_title) → blake3_hash from DuckDB."""
    index: dict[tuple, str] = {}
    try:
        conn = duckdb.connect(db_path, read_only=True)
        rows = conn.execute(
            "SELECT id, artist, title FROM tracks WHERE artist IS NOT NULL AND title IS NOT NULL"
        ).fetchall()
        conn.close()
        for h, artist, title in rows:
            index[(_norm(artist), _norm(title))] = h
        logger.info(f"Built match index: {len(index)} tracks")
    except Exception as e:
        logger.error(f"Could not read DuckDB: {e}")
    return index

def match(index: dict, artist: str, title: str) -> str | None:
    return index.get((_norm(artist), _norm(title)))


# ── Import logic ──────────────────────────────────────────────────────────────

async def import_scrobbles(nc, from_ts: int = 0) -> int:
    """Fetch all scrobbles (optionally since from_ts) and publish matched ones.
    Returns the unix timestamp of the newest scrobble seen."""

    index = build_index(DB_PATH)
    if not index:
        logger.warning("Library index is empty — is EchoGraph running and tracks ingested?")
        return from_ts

    page, total_pages = 1, 1
    newest_ts = from_ts
    published = 0
    unmatched = 0
    play_counts: dict[str, int] = {}  # hash → count of scrobbles this run

    while page <= total_pages:
        data = fetch_page(page, from_ts)
        rt = data.get("recenttracks", {})
        attr = rt.get("@attr", {})
        total_pages = int(attr.get("totalPages", 1))
        tracks = rt.get("track", [])

        for t in tracks:
            # Skip "now playing" pseudo-entries (no date)
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
            await nc.publish(
                "phonolith.playback.started",
                json.dumps(event).encode(),
            )
            published += 1

            if published % BATCH_PUBLISH == 0:
                await asyncio.sleep(0)   # yield to event loop

        logger.info(f"Last.fm import: page {page}/{total_pages} — {published} published so far")
        page += 1
        await asyncio.sleep(0.25)   # respect Last.fm rate limit (5 req/s)

    # Publish playcount updates so the analytics dashboard shows last.fm plays
    for h, count in play_counts.items():
        await nc.publish(
            "phonolith.metadata.enriched",
            json.dumps({"blake3_hash": h, "lastfm_playcount": count}).encode(),
        )

    logger.info(
        f"Last.fm import complete: {published} plays published, "
        f"{unmatched} unmatched, {len(play_counts)} unique tracks updated"
    )
    return newest_ts


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    if not API_KEY or not USERNAME:
        logger.warning(
            "LASTFM_API_KEY / LASTFM_USERNAME not set — Last.fm service idle. "
            "Set these in .env to enable scrobble import."
        )
        await asyncio.Event().wait()
        return

    state = open_state()
    nc = await nats.connect(NATS_URL)
    logger.info(f"Last.fm import service started for user '{USERNAME}'")

    while True:
        from_ts = int(get_state(state, "last_import_ts", "0"))
        label = "initial import" if from_ts == 0 else f"incremental from {datetime.fromtimestamp(from_ts)}"
        logger.info(f"Starting {label}")

        newest = await import_scrobbles(nc, from_ts)
        if newest > from_ts:
            set_state(state, "last_import_ts", str(newest))

        logger.info(f"Next sync in {SYNC_INTERVAL // 3600}h")
        await asyncio.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
