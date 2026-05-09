"""
Plex Media Server sync service.

Polls the Plex API to pull:
  - Play counts and last-played timestamps → published as phonolith.playback.started
  - User star ratings (1–5 mapped from Plex 0–10 scale) → published as
    phonolith.metadata.enriched with plex_rating

Tracks are matched to local DuckDB entries first by file path (normalised),
then by (artist, title) if the path doesn't match.

Set PLEX_URL and PLEX_TOKEN in .env. The service is silently idle if either
is absent.
"""

import asyncio, json, os, re, sqlite3
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

import duckdb, nats, requests
from loguru import logger

NATS_URL       = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR       = os.getenv("DATA_DIR", "/data")
DB_PATH        = os.path.join(DATA_DIR, "phonolith.duckdb")
STATE_DB       = os.path.join(DATA_DIR, "plex_state.sqlite")
LIBRARY_PATH   = os.getenv("LIBRARY_PATH", "/library")

PLEX_URL       = os.getenv("PLEX_URL", "").rstrip("/")
PLEX_TOKEN     = os.getenv("PLEX_TOKEN", "")
SYNC_INTERVAL  = int(os.getenv("PLEX_SYNC_INTERVAL_HOURS", "1")) * 3600

HEADERS = {
    "X-Plex-Token": PLEX_TOKEN,
    "Accept": "application/json",
}


# ── State ─────────────────────────────────────────────────────────────────────

def open_state() -> sqlite3.Connection:
    c = sqlite3.connect(STATE_DB)
    c.execute("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)")
    c.commit()
    return c

def get_state(c, key, default=None):
    row = c.execute("SELECT value FROM state WHERE key=?", [key]).fetchone()
    return row[0] if row else default

def set_state(c, key, value):
    c.execute("INSERT OR REPLACE INTO state VALUES (?,?)", [key, value])
    c.commit()


# ── Plex API helpers ──────────────────────────────────────────────────────────

def plex_get(path: str, **params) -> dict | None:
    try:
        r = requests.get(f"{PLEX_URL}{path}", headers=HEADERS, params=params, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Plex API {path}: {e}")
        return None

def get_music_sections() -> list[dict]:
    data = plex_get("/library/sections")
    if not data:
        return []
    sections = data.get("MediaContainer", {}).get("Directory", [])
    return [s for s in sections if s.get("type") == "artist"]

def get_all_tracks(section_key: str) -> list[dict]:
    """Fetch all tracks from a Plex music library section (type=10 = track)."""
    data = plex_get(f"/library/sections/{section_key}/all", type=10)
    if not data:
        return []
    return data.get("MediaContainer", {}).get("Metadata", [])


# ── Track matching ────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", s.lower().strip()))

def build_index(db_path: str):
    """Return (path_index, title_index) dicts mapping to blake3_hash."""
    path_idx: dict[str, str] = {}
    title_idx: dict[tuple, str] = {}
    try:
        conn = duckdb.connect(db_path, read_only=True)
        rows = conn.execute("SELECT id, path, artist, title FROM tracks").fetchall()
        conn.close()
        for h, path, artist, title in rows:
            path_idx[path] = h
            if artist and title:
                title_idx[(_norm(artist), _norm(title))] = h
        logger.info(f"Plex match index: {len(path_idx)} paths, {len(title_idx)} title pairs")
    except Exception as e:
        logger.error(f"Could not read DuckDB: {e}")
    return path_idx, title_idx

def plex_path_to_local(plex_file: str) -> str:
    """
    Plex stores paths as they appear inside its container.
    We mount the library at LIBRARY_PATH inside our container.
    Try to reconstruct the local path by matching the filename portion.
    """
    p = PurePosixPath(plex_file)
    return str(Path(LIBRARY_PATH) / p.name)

def resolve_hash(path_idx, title_idx, plex_track: dict) -> str | None:
    media = plex_track.get("Media", [{}])[0]
    parts = media.get("Part", [{}])
    plex_file = parts[0].get("file", "") if parts else ""

    # 1. Exact path match
    if plex_file in path_idx:
        return path_idx[plex_file]

    # 2. Reconstructed local path
    local = plex_path_to_local(plex_file)
    if local in path_idx:
        return path_idx[local]

    # 3. Filename-only match
    fname = Path(plex_file).name
    for p, h in path_idx.items():
        if Path(p).name == fname:
            return h

    # 4. Artist + title
    artist = plex_track.get("grandparentTitle", "")
    title  = plex_track.get("title", "")
    if artist and title:
        return title_idx.get((_norm(artist), _norm(title)))

    return None


# ── Sync ──────────────────────────────────────────────────────────────────────

async def sync(nc, state: sqlite3.Connection) -> None:
    last_sync = int(get_state(state, "last_sync_ts", "0"))
    sections  = get_music_sections()
    if not sections:
        logger.warning("No music library sections found in Plex")
        return

    path_idx, title_idx = build_index(DB_PATH)
    now = int(datetime.now(timezone.utc).timestamp())

    matched = 0
    for section in sections:
        key = section["key"]
        tracks = get_all_tracks(key)
        logger.info(f"Plex section '{section.get('title')}': {len(tracks)} tracks")

        for t in tracks:
            h = resolve_hash(path_idx, title_idx, t)
            if not h:
                continue

            matched += 1
            view_count  = t.get("viewCount", 0)
            last_viewed = t.get("lastViewedAt")  # unix timestamp
            plex_rating = t.get("userRating")    # 0-10 Plex scale → 0-5 stars

            # Publish rating update
            meta: dict = {"blake3_hash": h}
            if plex_rating is not None:
                meta["plex_rating"] = round(plex_rating / 2, 1)   # 0–5
            if meta.keys() - {"blake3_hash"}:
                await nc.publish(
                    "phonolith.metadata.enriched",
                    json.dumps(meta).encode(),
                )

            # Publish a single play event for the last played date
            # (avoid re-importing plays already imported)
            if last_viewed and last_viewed > last_sync:
                event = {
                    "blake3_hash": h,
                    "timestamp": datetime.fromtimestamp(
                        last_viewed, tz=timezone.utc
                    ).isoformat(),
                    "source": "plex",
                    "endpoint_id": None,
                    "format": None,
                }
                await nc.publish(
                    "phonolith.playback.started",
                    json.dumps(event).encode(),
                )

            await asyncio.sleep(0)   # yield frequently

    set_state(state, "last_sync_ts", str(now))
    logger.info(f"Plex sync complete: {matched} tracks matched across {len(sections)} section(s)")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    if not PLEX_URL or not PLEX_TOKEN:
        logger.warning(
            "PLEX_URL / PLEX_TOKEN not set — Plex sync service idle. "
            "Set these in .env to enable Plex integration."
        )
        await asyncio.Event().wait()
        return

    state = open_state()
    nc    = await nats.connect(NATS_URL)
    logger.info(f"Plex sync service started → {PLEX_URL}")

    while True:
        await sync(nc, state)
        logger.info(f"Next Plex sync in {SYNC_INTERVAL // 3600}h")
        await asyncio.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
