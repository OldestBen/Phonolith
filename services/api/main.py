import json, os, sqlite3
from contextlib import asynccontextmanager
from typing import Optional
from loguru import logger
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
import duckdb
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DB_PATH = os.getenv("DB_PATH", "/data/phonolith.duckdb")
ENGRAM_DB = os.getenv("ENGRAM_DB", "/data/engram.db")

nc_client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global nc_client
    try:
        nc_client = await nats.connect(NATS_URL)
        logger.info(f"Connected to NATS at {NATS_URL}")
    except Exception as e:
        logger.warning(f"NATS connection failed (non-fatal): {e}")
    yield
    if nc_client:
        await nc_client.drain()
        logger.info("NATS connection drained")


app = FastAPI(title="Phonolith API", version="0.1.0", lifespan=lifespan)


def get_db():
    return duckdb.connect(DB_PATH, read_only=True)


def get_engram_db():
    return sqlite3.connect(ENGRAM_DB)


# --- Request/Response Models ---

class PlayRequest(BaseModel):
    hash: str
    endpoint_id: Optional[str] = None
    validate_hash: bool = True


class RestoreRequest(BaseModel):
    snapshot_id: str


# --- Health ---

@app.get("/api/health")
async def health():
    services = []
    db_ok = False
    try:
        conn = get_db()
        conn.execute("SELECT 1").fetchone()
        conn.close()
        db_ok = True
        services.append("duckdb")
    except Exception:
        pass
    if nc_client and nc_client.is_connected:
        services.append("nats")
    return {"status": "ok", "services": services, "db_ok": db_ok}


# --- Library ---

@app.get("/api/library/tracks")
async def list_tracks(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    artist: Optional[str] = None,
    album: Optional[str] = None,
    genre: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = Query("title", pattern="^(title|artist|dr_score|internal_rating)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
):
    conn = get_db()
    try:
        conditions = []
        params = []
        if artist:
            conditions.append("LOWER(artist) LIKE LOWER(?)")
            params.append(f"%{artist}%")
        if album:
            conditions.append("LOWER(album) LIKE LOWER(?)")
            params.append(f"%{album}%")
        if genre:
            conditions.append("LOWER(genre) LIKE LOWER(?)")
            params.append(f"%{genre}%")
        if search:
            conditions.append("(LOWER(title) LIKE LOWER(?) OR LOWER(artist) LIKE LOWER(?) OR LOWER(album) LIKE LOWER(?))")
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        offset = (page - 1) * per_page

        count_row = conn.execute(f"SELECT COUNT(*) FROM tracks {where}", params).fetchone()
        total = count_row[0] if count_row else 0

        rows = conn.execute(
            f"SELECT hash, path, title, artist, album, genre, format, duration_seconds, "
            f"dr_score, internal_rating, prism_status FROM tracks {where} "
            f"ORDER BY {sort} {order} LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

        cols = ["hash", "path", "title", "artist", "album", "genre", "format",
                "duration_seconds", "dr_score", "internal_rating", "prism_status"]
        tracks = [dict(zip(cols, row)) for row in rows]
        return {"tracks": tracks, "total": total, "page": page, "per_page": per_page}
    finally:
        conn.close()


@app.get("/api/library/tracks/{hash}")
async def get_track(hash: str):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT hash, path, title, artist, album, genre, format, duration_seconds, "
            "dr_score, internal_rating, prism_status, label, year FROM tracks WHERE hash = ?",
            [hash],
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Track not found")
        cols = ["hash", "path", "title", "artist", "album", "genre", "format",
                "duration_seconds", "dr_score", "internal_rating", "prism_status", "label", "year"]
        return dict(zip(cols, row))
    finally:
        conn.close()


@app.get("/api/library/albums")
async def list_albums():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT album, artist, AVG(dr_score) as avg_dr_score, COUNT(*) as track_count "
            "FROM tracks GROUP BY album, artist ORDER BY artist, album"
        ).fetchall()
        return [{"album": r[0], "artist": r[1], "avg_dr_score": r[2], "track_count": r[3]} for r in rows]
    finally:
        conn.close()


@app.get("/api/library/artists")
async def list_artists():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT artist, COUNT(*) as track_count, AVG(dr_score) as avg_dr_score "
            "FROM tracks GROUP BY artist ORDER BY artist"
        ).fetchall()
        return [{"artist": r[0], "track_count": r[1], "avg_dr_score": r[2]} for r in rows]
    finally:
        conn.close()


# --- Analytics ---

@app.get("/api/analytics/overview")
async def analytics_overview():
    conn = get_db()
    try:
        r = conn.execute(
            "SELECT COUNT(*) as total_tracks, "
            "COUNT(DISTINCT album) as total_albums, "
            "COUNT(DISTINCT artist) as total_artists, "
            "SUM(CASE WHEN format IN ('flac','wav','aiff','alac') THEN 1 ELSE 0 END) as lossless_count, "
            "SUM(CASE WHEN format NOT IN ('flac','wav','aiff','alac') THEN 1 ELSE 0 END) as lossy_count, "
            "AVG(dr_score) as avg_dr "
            "FROM tracks"
        ).fetchone()

        ph = conn.execute(
            "SELECT COALESCE(SUM(duration_seconds)/3600.0, 0) FROM tracks"
        ).fetchone()

        return {
            "total_tracks": r[0], "total_albums": r[1], "total_artists": r[2],
            "lossless_count": r[3], "lossy_count": r[4],
            "avg_dr": round(r[5], 2) if r[5] else 0,
            "total_play_hours": round(ph[0], 2) if ph and ph[0] else 0,
        }
    finally:
        conn.close()


@app.get("/api/analytics/ghost")
async def analytics_ghost():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT t.hash, t.title, t.artist, t.album, t.dr_score, t.internal_rating, t.last_played_at "
            "FROM tracks t "
            "WHERE t.internal_rating >= 4 "
            "AND (t.last_played_at IS NULL OR t.last_played_at < NOW() - INTERVAL 365 DAYS) "
            "ORDER BY t.internal_rating DESC, t.dr_score DESC LIMIT 100"
        ).fetchall()
        cols = ["hash", "title", "artist", "album", "dr_score", "internal_rating", "last_played_at"]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        conn.close()


@app.get("/api/analytics/label-breakdown")
async def analytics_label_breakdown():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT label, COUNT(*) as count FROM tracks WHERE label IS NOT NULL "
            "GROUP BY label ORDER BY count DESC LIMIT 20"
        ).fetchall()
        return [{"label": r[0], "count": r[1]} for r in rows]
    finally:
        conn.close()


@app.get("/api/analytics/dr-heatmap")
async def analytics_dr_heatmap():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT CAST(FLOOR(dr_score) AS INTEGER) as dr, COUNT(*) as count "
            "FROM tracks WHERE dr_score IS NOT NULL "
            "GROUP BY CAST(FLOOR(dr_score) AS INTEGER) ORDER BY dr"
        ).fetchall()
        return [{"dr": r[0], "count": r[1]} for r in rows]
    finally:
        conn.close()


# --- Playback ---

@app.post("/api/playback/play", status_code=202)
async def playback_play(req: PlayRequest):
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    payload = {"hash": req.hash, "endpoint_id": req.endpoint_id, "validate_hash": req.validate_hash}
    await nc_client.publish("phonolith.lucid.play", json.dumps(payload).encode())
    return {"status": "queued", "hash": req.hash}


# --- Engram ---

@app.post("/api/engram/restore", status_code=202)
async def engram_restore(req: RestoreRequest):
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    payload = {"snapshot_id": req.snapshot_id}
    await nc_client.publish("phonolith.engram.restore", json.dumps(payload).encode())
    return {"status": "queued", "snapshot_id": req.snapshot_id}


@app.get("/api/engram/snapshots/{hash}")
async def engram_snapshots(hash: str):
    try:
        conn = get_engram_db()
        rows = conn.execute(
            "SELECT id, hash, snapshot_type, captured_at, metadata FROM snapshots WHERE hash = ? ORDER BY captured_at DESC",
            [hash],
        ).fetchall()
        conn.close()
        cols = ["id", "hash", "snapshot_type", "captured_at", "metadata"]
        return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
