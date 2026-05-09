import asyncio, json, os, sqlite3, struct, gzip, io, tempfile
from contextlib import asynccontextmanager
from typing import Optional
from loguru import logger
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import duckdb
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DB_PATH = os.getenv("DB_PATH", "/data/phonolith.duckdb")
ENGRAM_DB     = os.getenv("ENGRAM_DB",     "/data/engram.db")
POLYPHONY_DB  = os.getenv("POLYPHONY_DB", "/data/polyphony.db")

nc_client = None
_ws_clients: set[WebSocket] = set()


async def _broadcast(data: str) -> None:
    dead = set()
    for ws in _ws_clients:
        try:
            await ws.send_text(data)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global nc_client
    try:
        nc_client = await nats.connect(NATS_URL)
        logger.info(f"Connected to NATS at {NATS_URL}")

        async def _on_playback(msg):
            try:
                await _broadcast(msg.data.decode())
            except Exception as e:
                logger.warning(f"WebSocket broadcast error: {e}")

        await nc_client.subscribe("phonolith.playback.>", cb=_on_playback)
        await nc_client.subscribe("phonolith.flux.endpoints", cb=_on_playback)
        await nc_client.subscribe("phonolith.flux.zones",     cb=_on_playback)
        await nc_client.subscribe("phonolith.health.smart",   cb=_on_smart)
        logger.info("Subscribed to NATS topics for WebSocket fan-out and health cache")
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
            f"SELECT id AS hash, path, filename, title, artist, album, genre, format, "
            f"bit_depth, sample_rate, duration_seconds, "
            f"dr_score, internal_rating, prism_status FROM tracks {where} "
            f"ORDER BY {sort} {order} LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

        cols = ["hash", "path", "filename", "title", "artist", "album", "genre", "format",
                "bit_depth", "sample_rate", "duration_seconds",
                "dr_score", "internal_rating", "prism_status"]
        tracks = [dict(zip(cols, row)) for row in rows]
        return {"tracks": tracks, "total": total, "page": page, "per_page": per_page}
    finally:
        conn.close()


@app.get("/api/library/tracks/{hash}")
async def get_track(hash: str):
    conn = get_db()
    try:
        row = conn.execute(
            """SELECT id AS hash, path, filename, title, artist, album_artist, album,
                      genre, format, bit_depth, sample_rate, bitrate_kbps, duration_seconds,
                      dr_score, peak_level, rms_level, crest_factor,
                      internal_rating, embedded_rating, prism_status, prism_fraud_reason,
                      spectral_cutoff_hz, accuraterip_result,
                      label, year, composer, lyricist, engineer, mastered_by, mixer, remixed_by,
                      bpm, initial_key, detected_bpm, detected_key, mood,
                      musicbrainz_release_group_id, musicbrainz_release_id,
                      discogs_release_id, is_primary_version, is_shadowed
               FROM tracks WHERE id = ?""",
            [hash],
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Track not found")
        cols = [
            "hash", "path", "filename", "title", "artist", "album_artist", "album",
            "genre", "format", "bit_depth", "sample_rate", "bitrate_kbps", "duration_seconds",
            "dr_score", "peak_level", "rms_level", "crest_factor",
            "internal_rating", "embedded_rating", "prism_status", "prism_fraud_reason",
            "spectral_cutoff_hz", "accuraterip_result",
            "label", "year", "composer", "lyricist", "engineer", "mastered_by", "mixer", "remixed_by",
            "bpm", "initial_key", "detected_bpm", "detected_key", "mood",
            "musicbrainz_release_group_id", "musicbrainz_release_id",
            "discogs_release_id", "is_primary_version", "is_shadowed",
        ]
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


@app.get("/api/analytics/genre-evolution")
async def analytics_genre_evolution(top_n: int = Query(8, ge=2, le=20)):
    """
    Returns data for a genre evolution Sankey: flows between consecutive
    5-year bands showing play counts per genre.
    Nodes: genre+period pairs. Links: plays that cross period boundaries
    (i.e. same genre listened to in adjacent periods).
    """
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT
                CAST(FLOOR(YEAR(played_at) / 5) * 5 AS INTEGER) AS period,
                t.genre,
                COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks t ON t.id = pe.blake3_hash
            WHERE t.genre IS NOT NULL
              AND pe.played_at IS NOT NULL
            GROUP BY period, t.genre
            ORDER BY period, plays DESC
            """
        ).fetchall()

        if not rows:
            return {"nodes": [], "links": []}

        # Keep only top_n genres by total play count
        from collections import defaultdict
        genre_totals: dict = defaultdict(int)
        for _, genre, plays in rows:
            genre_totals[genre] += plays
        top_genres = {g for g, _ in sorted(genre_totals.items(), key=lambda x: -x[1])[:top_n]}

        # Build period→genre→plays map
        period_genre: dict = defaultdict(lambda: defaultdict(int))
        for period, genre, plays in rows:
            if genre in top_genres:
                period_genre[period][genre] += plays

        periods = sorted(period_genre.keys())

        # Build Sankey nodes and links
        nodes = []
        node_index: dict = {}
        for period in periods:
            for genre in sorted(period_genre[period].keys()):
                label = f"{genre} ({period}s)"
                node_index[(period, genre)] = len(nodes)
                nodes.append({"name": label})

        links = []
        for i in range(len(periods) - 1):
            p1, p2 = periods[i], periods[i + 1]
            for genre in top_genres:
                if genre in period_genre[p1] and genre in period_genre[p2]:
                    src = node_index.get((p1, genre))
                    dst = node_index.get((p2, genre))
                    if src is not None and dst is not None:
                        links.append({
                            "source": src,
                            "target": dst,
                            "value":  min(period_genre[p1][genre], period_genre[p2][genre]),
                        })

        return {"nodes": nodes, "links": links, "periods": periods}
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


# --- Mastering Engineer Matrix ---

@app.get("/api/analytics/mastering-engineers")
async def mastering_engineers(limit: int = Query(30, ge=1, le=100)):
    """
    Ranks mastering engineers (and audio engineers) in your library by:
    average DR score, average internal rating, track count, and
    percentage of your library they represent.
    """
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT
                COALESCE(mastered_by, engineer) AS credit,
                COUNT(*) AS track_count,
                AVG(dr_score) AS avg_dr,
                AVG(internal_rating) AS avg_rating,
                AVG(peak_level) AS avg_peak,
                AVG(rms_level) AS avg_rms,
                COUNT(CASE WHEN format IN ('flac','wav','aiff','alac') THEN 1 END) AS lossless_count
            FROM tracks
            WHERE COALESCE(mastered_by, engineer) IS NOT NULL
            GROUP BY credit
            HAVING track_count >= 2
            ORDER BY avg_dr DESC NULLS LAST
            LIMIT ?
            """,
            [limit],
        ).fetchall()
        cols = ["credit", "track_count", "avg_dr", "avg_rating",
                "avg_peak", "avg_rms", "lossless_count"]
        total_tracks = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0] or 1
        result = []
        for r in rows:
            d = dict(zip(cols, r))
            d["avg_dr"] = round(d["avg_dr"], 1) if d["avg_dr"] else None
            d["avg_rating"] = round(d["avg_rating"], 2) if d["avg_rating"] else None
            d["avg_peak"] = round(d["avg_peak"], 2) if d["avg_peak"] else None
            d["avg_rms"] = round(d["avg_rms"], 2) if d["avg_rms"] else None
            d["library_pct"] = round(d["track_count"] / total_tracks * 100, 1)
            result.append(d)
        return result
    finally:
        conn.close()


@app.get("/api/analytics/mastering-engineers/{credit}/tracks")
async def mastering_engineer_tracks(
    credit: str,
    limit: int = Query(50, ge=1, le=200),
    sort: str = Query("dr_score", pattern="^(dr_score|internal_rating|year|title)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
):
    """Return all tracks credited to a specific mastering/audio engineer."""
    conn = get_db()
    try:
        rows = conn.execute(
            f"""
            SELECT id AS hash, title, artist, album, year, format, bit_depth, sample_rate,
                   dr_score, peak_level, rms_level, internal_rating, prism_status
            FROM tracks
            WHERE COALESCE(mastered_by, engineer) = ?
            ORDER BY {sort} {order} NULLS LAST
            LIMIT ?
            """,
            [credit, limit],
        ).fetchall()
        cols = ["hash", "title", "artist", "album", "year", "format", "bit_depth",
                "sample_rate", "dr_score", "peak_level", "rms_level", "internal_rating", "prism_status"]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        conn.close()


# --- BPM / Key mismatch report ---

@app.get("/api/analytics/bpm-key-mismatches")
async def bpm_key_mismatches(
    bpm_tolerance: float = Query(5.0, description="Allowed BPM deviation before flagging"),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Tracks where tag BPM or key differs from the librosa-detected value.
    Useful for finding badly tagged files or BPM-doubled tags.
    """
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT id AS hash, path, title, artist, album,
                   bpm AS tag_bpm, detected_bpm,
                   initial_key AS tag_key, detected_key,
                   ABS(COALESCE(bpm, 0) - COALESCE(detected_bpm, 0)) AS bpm_delta
            FROM tracks
            WHERE detected_bpm IS NOT NULL
              AND (
                  (bpm IS NOT NULL AND ABS(bpm - detected_bpm) > ?)
                  OR (initial_key IS NOT NULL AND UPPER(TRIM(initial_key)) != UPPER(TRIM(detected_key)))
              )
            ORDER BY bpm_delta DESC
            LIMIT ?
            """,
            [bpm_tolerance, limit],
        ).fetchall()
        cols = ["hash", "path", "title", "artist", "album",
                "tag_bpm", "detected_bpm", "tag_key", "detected_key", "bpm_delta"]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        conn.close()


# --- Version Manager ---

class SetPrimaryRequest(BaseModel):
    hash: str


@app.get("/api/versions")
async def list_version_groups():
    """
    Return all albums that have more than one version (pressing) in the library,
    grouped by MusicBrainz release group ID when available, otherwise by
    normalised album+artist string.
    """
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT
                COALESCE(musicbrainz_release_group_id, LOWER(TRIM(album || '|||' || COALESCE(album_artist, artist)))) AS group_key,
                album,
                COALESCE(album_artist, artist) AS artist,
                COUNT(DISTINCT id) AS version_count
            FROM tracks
            WHERE album IS NOT NULL
            GROUP BY group_key, album, artist
            HAVING COUNT(DISTINCT id) > 1
            ORDER BY version_count DESC, artist, album
            LIMIT 200
            """
        ).fetchall()
        cols = ["group_key", "album", "artist", "version_count"]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        conn.close()


@app.get("/api/versions/{group_key:path}")
async def get_version_group(group_key: str):
    """
    Return all tracks in a version group with their sonic metadata for comparison.
    group_key is either a MusicBrainz release group ID or the encoded album|||artist string.
    """
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT
                id AS hash, path, filename, title, artist, album_artist, album,
                year, format, bit_depth, sample_rate, bitrate_kbps, duration_seconds,
                dr_score, peak_level, rms_level, crest_factor,
                label, mastered_by, engineer,
                is_primary_version, is_shadowed,
                musicbrainz_release_id, musicbrainz_release_group_id,
                discogs_release_id, prism_status
            FROM tracks
            WHERE COALESCE(musicbrainz_release_group_id,
                  LOWER(TRIM(album || '|||' || COALESCE(album_artist, artist)))) = ?
            ORDER BY dr_score DESC NULLS LAST, year
            """,
            [group_key],
        ).fetchall()
        cols = [
            "hash", "path", "filename", "title", "artist", "album_artist", "album",
            "year", "format", "bit_depth", "sample_rate", "bitrate_kbps", "duration_seconds",
            "dr_score", "peak_level", "rms_level", "crest_factor",
            "label", "mastered_by", "engineer",
            "is_primary_version", "is_shadowed",
            "musicbrainz_release_id", "musicbrainz_release_group_id",
            "discogs_release_id", "prism_status",
        ]
        versions = [dict(zip(cols, r)) for r in rows]

        # Flag if any "remaster" has lower DR than the oldest version (loudness war victim)
        if len(versions) >= 2:
            sorted_by_year = sorted(versions, key=lambda v: v["year"] or 9999)
            oldest_dr = sorted_by_year[0].get("dr_score")
            for v in versions:
                v["loudness_war_flag"] = (
                    oldest_dr is not None
                    and v.get("dr_score") is not None
                    and v["year"] is not None
                    and v["year"] > (sorted_by_year[0]["year"] or 0)
                    and v["dr_score"] < oldest_dr
                )
        return versions
    finally:
        conn.close()


@app.post("/api/versions/set-primary")
async def set_primary_version(req: SetPrimaryRequest):
    """
    Mark one track as the primary version and shadow all others in the same group.
    Writes directly to DuckDB — API uses a write connection only for this endpoint.
    """
    write_conn = duckdb.connect(DB_PATH, read_only=False)
    try:
        row = write_conn.execute(
            """SELECT COALESCE(musicbrainz_release_group_id,
               LOWER(TRIM(album || '|||' || COALESCE(album_artist, artist))))
               FROM tracks WHERE id = ?""",
            [req.hash],
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Track not found")
        group_key = row[0]

        write_conn.execute(
            """UPDATE tracks
               SET is_primary_version = (id = ?), is_shadowed = (id != ?)
               WHERE COALESCE(musicbrainz_release_group_id,
                     LOWER(TRIM(album || '|||' || COALESCE(album_artist, artist)))) = ?""",
            [req.hash, req.hash, group_key],
        )
        write_conn.commit()
        return {"status": "ok", "primary": req.hash, "group_key": group_key}
    finally:
        write_conn.close()


# --- AirPlay endpoints ---

@app.get("/api/flux/endpoints")
async def flux_endpoints():
    """Return the live list of discovered AirPlay endpoints from Flux."""
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    return {"endpoints": []}   # Real-time data comes via WebSocket; this is a stub for polling


class AirPlayStreamRequest(BaseModel):
    hash: str
    endpoint_id: str


@app.post("/api/flux/stream", status_code=202)
async def flux_stream(req: AirPlayStreamRequest):
    """Route a track to an AirPlay endpoint via Flux."""
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    conn = get_db()
    try:
        row = conn.execute("SELECT path FROM tracks WHERE id = ?", [req.hash]).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    payload = {"endpoint_id": req.endpoint_id, "path": row[0], "blake3_hash": req.hash}
    await nc_client.publish("phonolith.flux.stream", json.dumps(payload).encode())
    return {"status": "queued", "hash": req.hash, "endpoint_id": req.endpoint_id}


@app.post("/api/flux/stop", status_code=202)
async def flux_stop(endpoint_id: str):
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    await nc_client.publish("phonolith.flux.stop", json.dumps({"endpoint_id": endpoint_id}).encode())
    return {"status": "stop_sent", "endpoint_id": endpoint_id}


# --- AirPlay Zones ---

class ZoneRequest(BaseModel):
    zone_id:      str
    name:         str
    endpoint_ids: list[str]


class ZoneStreamRequest(BaseModel):
    zone_id: str
    hash:    str


@app.post("/api/flux/zones", status_code=202)
async def create_zone(req: ZoneRequest):
    """Create or update a named zone grouping multiple AirPlay endpoints."""
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    await nc_client.publish(
        "phonolith.flux.zone.create",
        json.dumps({"zone_id": req.zone_id, "name": req.name, "endpoint_ids": req.endpoint_ids}).encode(),
    )
    return {"status": "created", "zone_id": req.zone_id}


@app.delete("/api/flux/zones/{zone_id}", status_code=202)
async def delete_zone(zone_id: str):
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    await nc_client.publish(
        "phonolith.flux.zone.delete",
        json.dumps({"zone_id": zone_id}).encode(),
    )
    return {"status": "deleted", "zone_id": zone_id}


@app.post("/api/flux/zones/stream", status_code=202)
async def stream_to_zone(req: ZoneStreamRequest, db: duckdb.DuckDBPyConnection = Depends(get_db)):
    """Stream a track to all endpoints in a zone simultaneously."""
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    row = db.execute("SELECT path FROM tracks WHERE id = ?", [req.hash]).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    await nc_client.publish(
        "phonolith.flux.zone.stream",
        json.dumps({"zone_id": req.zone_id, "path": row[0], "blake3_hash": req.hash}).encode(),
    )
    return {"status": "queued", "zone_id": req.zone_id, "hash": req.hash}


@app.post("/api/flux/zones/{zone_id}/stop", status_code=202)
async def stop_zone(zone_id: str):
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    await nc_client.publish(
        "phonolith.flux.zone.stop",
        json.dumps({"zone_id": zone_id}).encode(),
    )
    return {"status": "stopped", "zone_id": zone_id}


# --- Playback ---

@app.post("/api/playback/play", status_code=202)
async def playback_play(req: PlayRequest):
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT path FROM tracks WHERE id = ?", [req.hash]
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    payload = {
        "blake3_hash": req.hash,
        "path": row[0],
        "endpoint_id": req.endpoint_id,
        "validate_hash": req.validate_hash,
    }
    await nc_client.publish("phonolith.lucid.play", json.dumps(payload).encode())
    return {"status": "queued", "hash": req.hash}


@app.websocket("/api/playback/ws")
async def playback_ws(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    logger.info(f"WebSocket client connected ({len(_ws_clients)} total)")
    try:
        while True:
            # Keep alive — client messages ignored; we only push
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)
        logger.info(f"WebSocket client disconnected ({len(_ws_clients)} remaining)")


# --- Waveform ---

@app.get("/api/waveform/{hash}")
async def get_waveform(hash: str):
    waveform_dir = os.getenv("WAVEFORM_DIR", "/data/waveforms")
    cache_file = os.path.join(waveform_dir, f"{hash}.json")
    if not os.path.exists(cache_file):
        raise HTTPException(status_code=404, detail="Waveform not yet computed")
    with open(cache_file) as f:
        return json.load(f)


# --- Opus Proxy ---

@app.get("/api/proxy/{hash}")
async def get_proxy(hash: str, request: Request, proxy: Optional[int] = None):
    """
    Stream the 128kbps Opus proxy for a track.
    Served when ?proxy=1 or when the X-Remote: true header is present.
    Returns 404 if the proxy hasn't been generated yet.
    """
    want_proxy = proxy == 1 or request.headers.get("x-remote", "").lower() == "true"
    if not want_proxy:
        raise HTTPException(status_code=400, detail="Pass ?proxy=1 or X-Remote: true")
    proxy_dir = os.getenv("PROXY_DIR", "/data/proxies")
    proxy_file = os.path.join(proxy_dir, f"{hash}.opus")
    if not os.path.exists(proxy_file):
        raise HTTPException(status_code=404, detail="Proxy not yet generated")
    return FileResponse(
        proxy_file,
        media_type="audio/ogg",
        filename=f"{hash}.opus",
    )


# --- Semantic Search ---

def _load_semantic_db():
    semantic_db = os.getenv("SEMANTIC_DB", "/data/semantic.db")
    if not os.path.exists(semantic_db):
        return None
    return sqlite3.connect(semantic_db, check_same_thread=False)


def _unpack_vector(blob: bytes):
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


def _cosine(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    # Vectors are pre-normalised in the semantic service, so dot == cosine sim
    return dot


@app.get("/api/search/similar/{hash}")
async def search_similar(hash: str, limit: int = Query(10, ge=1, le=50)):
    """Return the N most acoustically similar tracks to the given hash."""
    conn = _load_semantic_db()
    if conn is None:
        raise HTTPException(status_code=503, detail="Semantic index not ready")
    try:
        row = conn.execute(
            "SELECT vector FROM embeddings WHERE blake3_hash = ?", [hash]
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No embedding for this track yet")

        query_vec = _unpack_vector(row[0])
        rows = conn.execute(
            "SELECT blake3_hash, path, bpm, key_index, spectral_centroid, rms_energy, vector "
            "FROM embeddings WHERE blake3_hash != ?",
            [hash],
        ).fetchall()

        scored = []
        for r in rows:
            candidate_vec = _unpack_vector(r[6])
            score = _cosine(query_vec, candidate_vec)
            scored.append({
                "blake3_hash":      r[0],
                "path":             r[1],
                "bpm":              r[2],
                "key_index":        r[3],
                "spectral_centroid": r[4],
                "rms_energy":       r[5],
                "similarity":       round(score, 4),
            })

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:limit]
    finally:
        conn.close()


@app.get("/api/search/semantic")
async def search_semantic(
    min_bpm: Optional[float] = None,
    max_bpm: Optional[float] = None,
    key: Optional[int] = Query(None, ge=0, le=11),
    min_energy: Optional[float] = None,
    max_energy: Optional[float] = None,
    limit: int = Query(20, ge=1, le=100),
):
    """
    Filter tracks by acoustic attributes.
    key: chromatic pitch class 0=C, 1=C#, 2=D … 11=B
    energy/bpm: raw librosa values (bpm ~60-180, rms_energy ~0.0-0.5)
    """
    conn = _load_semantic_db()
    if conn is None:
        raise HTTPException(status_code=503, detail="Semantic index not ready")
    try:
        conditions = []
        params = []
        if min_bpm is not None:
            conditions.append("bpm >= ?"); params.append(min_bpm)
        if max_bpm is not None:
            conditions.append("bpm <= ?"); params.append(max_bpm)
        if key is not None:
            conditions.append("key_index = ?"); params.append(key)
        if min_energy is not None:
            conditions.append("rms_energy >= ?"); params.append(min_energy)
        if max_energy is not None:
            conditions.append("rms_energy <= ?"); params.append(max_energy)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        rows = conn.execute(
            f"SELECT blake3_hash, path, bpm, key_index, spectral_centroid, rms_energy, duration_seconds "
            f"FROM embeddings {where} ORDER BY bpm LIMIT ?",
            params + [limit],
        ).fetchall()

        cols = ["blake3_hash", "path", "bpm", "key_index",
                "spectral_centroid", "rms_energy", "duration_seconds"]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        conn.close()


# --- Data Janitor ---

@app.get("/api/janitor/silent-tracks")
async def janitor_silent_tracks(
    peak_threshold: float = Query(-50.0, description="Peak level dBFS ceiling"),
    rms_threshold:  float = Query(-60.0, description="RMS level dBFS ceiling"),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Tracks where measured levels suggest silence or near-silence."""
    rows = db.execute(
        """SELECT id AS hash, path, filename, title, artist, album, year,
                  peak_level, rms_level, duration_seconds, dr_score, format
           FROM tracks
           WHERE (peak_level IS NOT NULL AND peak_level < ?)
              OR (rms_level  IS NOT NULL AND rms_level  < ?)
           ORDER BY peak_level ASC NULLS LAST
           LIMIT 500""",
        [peak_threshold, rms_threshold],
    ).fetchall()
    cols = ["hash", "path", "filename", "title", "artist", "album", "year",
            "peak_level", "rms_level", "duration_seconds", "dr_score", "format"]
    return [dict(zip(cols, r)) for r in rows]


@app.get("/api/janitor/artwork-audit")
async def janitor_artwork_audit(
    min_dimension: int = Query(500, description="Minimum acceptable artwork dimension (px)"),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Albums with missing or low-resolution embedded artwork."""
    rows = db.execute(
        """SELECT a.id, a.title AS album, a.artist,
                  a.artwork_path, a.artwork_width, a.artwork_height,
                  COUNT(t.id) AS track_count,
                  CASE
                    WHEN a.artwork_path IS NULL THEN 'missing'
                    WHEN COALESCE(a.artwork_width,0) < ? OR COALESCE(a.artwork_height,0) < ? THEN 'low_res'
                    ELSE 'ok'
                  END AS issue
           FROM albums a
           LEFT JOIN tracks t
             ON LOWER(TRIM(t.album)) = LOWER(TRIM(a.title))
            AND LOWER(TRIM(COALESCE(t.album_artist, t.artist, ''))) = LOWER(TRIM(COALESCE(a.artist,'')))
           WHERE a.artwork_path IS NULL
              OR a.artwork_width  < ?
              OR a.artwork_height < ?
           GROUP BY a.id, a.title, a.artist, a.artwork_path, a.artwork_width, a.artwork_height
           ORDER BY issue, a.title
           LIMIT 300""",
        [min_dimension, min_dimension, min_dimension, min_dimension],
    ).fetchall()
    cols = ["id", "album", "artist", "artwork_path", "artwork_width",
            "artwork_height", "track_count", "issue"]
    return [dict(zip(cols, r)) for r in rows]


@app.get("/api/janitor/missing-disc")
async def janitor_missing_disc(
    track_count_floor: int = Query(15, description="Minimum tracks for an album to be flagged"),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Albums that look like they span multiple discs but lack disc_number tags."""
    rows = db.execute(
        """SELECT album,
                  COALESCE(album_artist, artist) AS artist,
                  COUNT(*)                        AS track_count,
                  MAX(track_number)               AS max_track_number,
                  COUNT(CASE WHEN disc_number IS NOT NULL THEN 1 END) AS tagged_disc_count,
                  COUNT(CASE WHEN disc_number IS NULL     THEN 1 END) AS untagged_disc_count
           FROM tracks
           WHERE album IS NOT NULL
           GROUP BY album, COALESCE(album_artist, artist)
           HAVING (
             -- large album with no disc tags at all → likely multi-disc
             (MAX(track_number) > ? AND COUNT(CASE WHEN disc_number IS NOT NULL THEN 1 END) = 0)
             OR
             -- inconsistent tagging: some have disc_number, some don't
             (COUNT(CASE WHEN disc_number IS NOT NULL THEN 1 END) > 0
              AND COUNT(CASE WHEN disc_number IS NULL THEN 1 END) > 0)
           )
           ORDER BY track_count DESC
           LIMIT 200""",
        [track_count_floor],
    ).fetchall()
    cols = ["album", "artist", "track_count", "max_track_number",
            "tagged_disc_count", "untagged_disc_count"]
    return [dict(zip(cols, r)) for r in rows]


# --- Smart Playlists ---

@app.get("/api/playlists/preview")
async def playlist_preview(
    min_dr:       Optional[int]   = Query(None),
    max_dr:       Optional[int]   = Query(None),
    min_bpm:      Optional[float] = Query(None),
    max_bpm:      Optional[float] = Query(None),
    key:          Optional[str]   = Query(None, description="Musical key, e.g. C, C#, D …"),
    genre:        Optional[str]   = Query(None),
    min_year:     Optional[int]   = Query(None),
    max_year:     Optional[int]   = Query(None),
    min_rating:   Optional[float] = Query(None, ge=0, le=5),
    format:       Optional[str]   = Query(None, description="FLAC, MP3, AAC …"),
    engineer:     Optional[str]   = Query(None, description="Mastered-by or engineer credit"),
    lossless_only: bool           = Query(False),
    limit:        int             = Query(200, ge=1, le=2000),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Return tracks matching the given filter set (used for live preview)."""
    conditions, params = [], []

    if min_dr is not None:
        conditions.append("dr_score >= ?"); params.append(min_dr)
    if max_dr is not None:
        conditions.append("dr_score <= ?"); params.append(max_dr)
    if min_bpm is not None:
        conditions.append("COALESCE(detected_bpm, bpm) >= ?"); params.append(min_bpm)
    if max_bpm is not None:
        conditions.append("COALESCE(detected_bpm, bpm) <= ?"); params.append(max_bpm)
    if key is not None:
        conditions.append("(initial_key = ? OR detected_key = ?)"); params += [key, key]
    if genre is not None:
        conditions.append("LOWER(genre) LIKE ?"); params.append(f"%{genre.lower()}%")
    if min_year is not None:
        conditions.append("year >= ?"); params.append(min_year)
    if max_year is not None:
        conditions.append("year <= ?"); params.append(max_year)
    if min_rating is not None:
        conditions.append("internal_rating >= ?"); params.append(min_rating)
    if format is not None:
        conditions.append("LOWER(format) = ?"); params.append(format.lower())
    if engineer is not None:
        conditions.append(
            "(LOWER(COALESCE(mastered_by,'')) LIKE ? OR LOWER(COALESCE(engineer,'')) LIKE ?)"
        ); params += [f"%{engineer.lower()}%", f"%{engineer.lower()}%"]
    if lossless_only:
        conditions.append("format IN ('FLAC','WAV','AIFF','DSF','DFF','ALAC','APE','WV')")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = db.execute(
        f"""SELECT id AS hash, path, title, artist, album, year, format,
                   bit_depth, sample_rate, dr_score, internal_rating,
                   COALESCE(detected_bpm, bpm) AS bpm,
                   COALESCE(detected_key, initial_key) AS key
            FROM tracks {where}
            ORDER BY COALESCE(internal_rating, 0) DESC, dr_score DESC NULLS LAST
            LIMIT ?""",
        params + [limit],
    ).fetchall()
    cols = ["hash", "path", "title", "artist", "album", "year", "format",
            "bit_depth", "sample_rate", "dr_score", "internal_rating", "bpm", "key"]
    return [dict(zip(cols, r)) for r in rows]


from fastapi.responses import PlainTextResponse

@app.get("/api/playlists/export.m3u")
async def playlist_export_m3u(
    min_dr:       Optional[int]   = Query(None),
    max_dr:       Optional[int]   = Query(None),
    min_bpm:      Optional[float] = Query(None),
    max_bpm:      Optional[float] = Query(None),
    key:          Optional[str]   = Query(None),
    genre:        Optional[str]   = Query(None),
    min_year:     Optional[int]   = Query(None),
    max_year:     Optional[int]   = Query(None),
    min_rating:   Optional[float] = Query(None),
    format:       Optional[str]   = Query(None),
    engineer:     Optional[str]   = Query(None),
    lossless_only: bool           = Query(False),
    name:         str             = Query("Phonolith Playlist"),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Export matching tracks as an M3U playlist."""
    conditions, params = [], []

    if min_dr is not None:
        conditions.append("dr_score >= ?"); params.append(min_dr)
    if max_dr is not None:
        conditions.append("dr_score <= ?"); params.append(max_dr)
    if min_bpm is not None:
        conditions.append("COALESCE(detected_bpm, bpm) >= ?"); params.append(min_bpm)
    if max_bpm is not None:
        conditions.append("COALESCE(detected_bpm, bpm) <= ?"); params.append(max_bpm)
    if key is not None:
        conditions.append("(initial_key = ? OR detected_key = ?)"); params += [key, key]
    if genre is not None:
        conditions.append("LOWER(genre) LIKE ?"); params.append(f"%{genre.lower()}%")
    if min_year is not None:
        conditions.append("year >= ?"); params.append(min_year)
    if max_year is not None:
        conditions.append("year <= ?"); params.append(max_year)
    if min_rating is not None:
        conditions.append("internal_rating >= ?"); params.append(min_rating)
    if format is not None:
        conditions.append("LOWER(format) = ?"); params.append(format.lower())
    if engineer is not None:
        conditions.append(
            "(LOWER(COALESCE(mastered_by,'')) LIKE ? OR LOWER(COALESCE(engineer,'')) LIKE ?)"
        ); params += [f"%{engineer.lower()}%", f"%{engineer.lower()}%"]
    if lossless_only:
        conditions.append("format IN ('FLAC','WAV','AIFF','DSF','DFF','ALAC','APE','WV')")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = db.execute(
        f"""SELECT path, title, artist, duration_seconds
            FROM tracks {where}
            ORDER BY COALESCE(internal_rating, 0) DESC, dr_score DESC NULLS LAST
            LIMIT 2000""",
        params,
    ).fetchall()

    lines = ["#EXTM3U", f"#PLAYLIST:{name}"]
    for path, title, artist, duration in rows:
        dur = int(duration) if duration else -1
        display = f"{artist} - {title}" if artist and title else (title or path)
        lines.append(f"#EXTINF:{dur},{display}")
        lines.append(path)

    return PlainTextResponse(
        "\n".join(lines) + "\n",
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{name}.m3u"'},
    )


# --- Polyphony ---

def _open_polyphony_db():
    return sqlite3.connect(POLYPHONY_DB)


class FixDecisionRequest(BaseModel):
    fix_id: str
    action: str  # 'approve' | 'reject'


@app.get("/api/polyphony/fixes")
async def list_pending_fixes(status: str = Query("pending")):
    """List peer metadata fix proposals, filtered by status."""
    try:
        conn = _open_polyphony_db()
        rows = conn.execute(
            """SELECT id, blake3_hash, field, old_value, new_value,
                      peer_alias, received_at, status
               FROM pending_fixes WHERE status = ?
               ORDER BY received_at DESC LIMIT 200""",
            [status],
        ).fetchall()
        conn.close()
        cols = ["id", "blake3_hash", "field", "old_value", "new_value",
                "peer_alias", "received_at", "status"]
        # Enrich with track title/artist from DuckDB
        db = get_db()
        results = []
        for row in rows:
            d = dict(zip(cols, row))
            track_row = db.execute(
                "SELECT title, artist FROM tracks WHERE id = ?", [d["blake3_hash"]]
            ).fetchone()
            if track_row:
                d["track_title"]  = track_row[0]
                d["track_artist"] = track_row[1]
            results.append(d)
        db.close()
        return results
    except FileNotFoundError:
        return []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/polyphony/fixes/decide")
async def decide_fix(req: FixDecisionRequest):
    """Approve or reject a pending peer fix."""
    if req.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")
    if not nc_client or not nc_client.is_connected:
        raise HTTPException(status_code=503, detail="NATS unavailable")
    payload = {"fix_id": req.fix_id, "action": req.action}
    await nc_client.publish("phonolith.polyphony.fix.decision", json.dumps(payload).encode())
    return {"status": "queued", "fix_id": req.fix_id, "action": req.action}


@app.get("/api/polyphony/peers")
async def list_peers(db: duckdb.DuckDBPyConnection = Depends(get_db)):
    """List known trusted peers from DuckDB peer_nodes table."""
    rows = db.execute(
        """SELECT id, alias, wireguard_endpoint, last_seen_at, is_trusted, shared_track_count
           FROM peer_nodes ORDER BY last_seen_at DESC NULLS LAST"""
    ).fetchall()
    cols = ["id", "alias", "wireguard_endpoint", "last_seen_at", "is_trusted", "shared_track_count"]
    return [dict(zip(cols, r)) for r in rows]


# --- SMART Health ---

_smart_reports: dict[str, dict] = {}  # device -> latest report


async def _on_smart(msg) -> None:
    """Cache the latest S.M.A.R.T. report for each device."""
    try:
        data = json.loads(msg.data.decode())
        device = data.get("device", "unknown")
        _smart_reports[device] = data
    except Exception:
        pass


@app.get("/api/health/smart")
async def health_smart():
    """Return the latest cached S.M.A.R.T. report for each monitored drive."""
    return list(_smart_reports.values())


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
            """SELECT id, blake3_hash, triggered_by, snapshot_at,
                      is_restore_point, restore_label
               FROM tag_snapshots WHERE blake3_hash = ?
               ORDER BY snapshot_at DESC""",
            [hash],
        ).fetchall()
        conn.close()
        cols = ["id", "blake3_hash", "triggered_by", "snapshot_at",
                "is_restore_point", "restore_label"]
        return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Sonic Codex ---

def _build_codex_sqlite(db: duckdb.DuckDBPyConnection) -> bytes:
    """
    Produce a gzip-compressed SQLite file containing all library intelligence
    but no audio data and no absolute filesystem paths.
    """
    buf = io.BytesIO()
    conn = sqlite3.connect(":memory:")

    # ── Tracks (strip path for portability; keep hash as identity) ────────────
    conn.execute("""
        CREATE TABLE tracks (
            id TEXT, filename TEXT, title TEXT, artist TEXT, album_artist TEXT,
            album TEXT, year INTEGER, track_number INTEGER, disc_number INTEGER,
            genre TEXT, label TEXT, composer TEXT, lyricist TEXT, engineer TEXT,
            mixer TEXT, mastered_by TEXT, remixed_by TEXT, bpm REAL,
            initial_key TEXT, mood TEXT, detected_bpm REAL, detected_key TEXT,
            format TEXT, bit_depth INTEGER, sample_rate INTEGER,
            bitrate_kbps INTEGER, channels INTEGER, duration_seconds REAL,
            dr_score INTEGER, peak_level REAL, rms_level REAL,
            embedded_rating INTEGER, internal_rating REAL,
            prism_status TEXT, accuraterip_result TEXT,
            musicbrainz_track_id TEXT, musicbrainz_release_id TEXT,
            musicbrainz_release_group_id TEXT, musicbrainz_artist_id TEXT,
            acoustid TEXT, discogs_release_id TEXT,
            ingested_at TEXT, last_played_at TEXT
        )
    """)
    rows = db.execute("""
        SELECT id, filename, title, artist, album_artist, album, year,
               track_number, disc_number, genre, label, composer, lyricist,
               engineer, mixer, mastered_by, remixed_by, bpm, initial_key,
               mood, detected_bpm, detected_key, format, bit_depth,
               sample_rate, bitrate_kbps, channels, duration_seconds,
               dr_score, peak_level, rms_level, embedded_rating,
               internal_rating, prism_status, accuraterip_result,
               musicbrainz_track_id, musicbrainz_release_id,
               musicbrainz_release_group_id, musicbrainz_artist_id,
               acoustid, discogs_release_id, ingested_at, last_played_at
        FROM tracks
    """).fetchall()
    conn.executemany("INSERT INTO tracks VALUES (" + ",".join(["?"] * 43) + ")", rows)

    # ── Albums ────────────────────────────────────────────────────────────────
    conn.execute("""
        CREATE TABLE albums (
            id TEXT, title TEXT, artist TEXT, year INTEGER, label TEXT,
            total_tracks INTEGER, total_discs INTEGER,
            artwork_width INTEGER, artwork_height INTEGER,
            avg_dr_score REAL, musicbrainz_release_group_id TEXT,
            discogs_release_id TEXT, discogs_market_value REAL
        )
    """)
    arows = db.execute("""
        SELECT id, title, artist, year, label, total_tracks, total_discs,
               artwork_width, artwork_height, avg_dr_score,
               musicbrainz_release_group_id, discogs_release_id, discogs_market_value
        FROM albums
    """).fetchall()
    conn.executemany("INSERT INTO albums VALUES (" + ",".join(["?"] * 13) + ")", arows)

    # ── Play events (scrobble history) ────────────────────────────────────────
    conn.execute("""
        CREATE TABLE play_events (
            id TEXT, blake3_hash TEXT, played_at TEXT,
            duration_played_secs REAL, completed INTEGER,
            source TEXT, format_played TEXT
        )
    """)
    prows = db.execute("""
        SELECT id, blake3_hash, played_at, duration_played_secs,
               completed::INTEGER, source, format_played
        FROM play_events
    """).fetchall()
    conn.executemany("INSERT INTO play_events VALUES (?,?,?,?,?,?,?)", prows)

    # ── Codex metadata ────────────────────────────────────────────────────────
    conn.execute("""
        CREATE TABLE codex_meta (
            created_at TEXT, track_count INTEGER, play_event_count INTEGER,
            schema_version TEXT
        )
    """)
    from datetime import datetime, timezone
    conn.execute("INSERT INTO codex_meta VALUES (?,?,?,?)", [
        datetime.now(timezone.utc).isoformat(),
        len(rows), len(prows), "1.0",
    ])

    conn.commit()

    # Serialise SQLite → in-memory bytes, then gzip
    for chunk in conn.iterdump():
        pass  # ensures WAL is flushed
    conn.backup(sqlite3.connect(buf_path := tempfile.mktemp(suffix=".sqlite")))
    conn.close()
    with open(buf_path, "rb") as f:
        raw = f.read()
    os.unlink(buf_path)

    gz_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=gz_buf, mode="wb", compresslevel=9) as gz:
        gz.write(raw)
    return gz_buf.getvalue()


@app.get("/api/codex/export")
async def codex_export(db: duckdb.DuckDBPyConnection = Depends(get_db)):
    """Export the library Sonic Codex as a gzip-compressed SQLite (.codex) file."""
    data = await asyncio.get_event_loop().run_in_executor(
        None, _build_codex_sqlite, db
    )
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="phonolith.codex"'},
    )


@app.get("/api/codex/stats")
async def codex_stats(db: duckdb.DuckDBPyConnection = Depends(get_db)):
    """Return headline numbers that will appear on the Codex export card."""
    row = db.execute("""
        SELECT COUNT(*) AS track_count,
               COUNT(DISTINCT COALESCE(album_artist, artist)) AS artist_count,
               COUNT(DISTINCT album) AS album_count,
               SUM(duration_seconds) / 3600.0 AS total_hours,
               COUNT(CASE WHEN dr_score IS NOT NULL THEN 1 END) AS dr_analyzed,
               COUNT(CASE WHEN internal_rating IS NOT NULL THEN 1 END) AS rated_count
        FROM tracks
    """).fetchone()
    pe_row = db.execute("SELECT COUNT(*) FROM play_events").fetchone()
    return {
        "track_count":    row[0],
        "artist_count":   row[1],
        "album_count":    row[2],
        "total_hours":    round(row[3] or 0, 1),
        "dr_analyzed":    row[4],
        "rated_count":    row[5],
        "play_event_count": pe_row[0],
    }


# --- Cathode (hardware burn-in analytics) ---

@app.get("/api/cathode/summary")
async def cathode_summary(db: duckdb.DuckDBPyConnection = Depends(get_db)):
    """Per-endpoint play statistics: total hours, top genre, top format."""
    rows = db.execute("""
        SELECT
            pe.endpoint_id,
            he.name                                             AS endpoint_name,
            he.type                                             AS endpoint_type,
            he.model,
            COUNT(*)                                            AS play_count,
            SUM(pe.duration_played_secs) / 3600.0              AS hours_played,
            -- most common genre on this endpoint
            (SELECT t2.genre FROM play_events pe2
             JOIN tracks t2 ON t2.id = pe2.blake3_hash
             WHERE pe2.endpoint_id = pe.endpoint_id
               AND t2.genre IS NOT NULL
             GROUP BY t2.genre ORDER BY COUNT(*) DESC LIMIT 1) AS top_genre,
            -- most common format
            (SELECT pe2.format_played FROM play_events pe2
             WHERE pe2.endpoint_id = pe.endpoint_id
               AND pe2.format_played IS NOT NULL
             GROUP BY pe2.format_played ORDER BY COUNT(*) DESC LIMIT 1) AS top_format,
            MIN(pe.played_at)                                   AS first_use,
            MAX(pe.played_at)                                   AS last_use
        FROM play_events pe
        LEFT JOIN hardware_endpoints he ON he.id = pe.endpoint_id
        WHERE pe.endpoint_id IS NOT NULL
        GROUP BY pe.endpoint_id, he.name, he.type, he.model
        ORDER BY hours_played DESC
    """).fetchall()
    cols = ["endpoint_id", "endpoint_name", "endpoint_type", "model",
            "play_count", "hours_played", "top_genre", "top_format",
            "first_use", "last_use"]
    return [dict(zip(cols, r)) for r in rows]


@app.get("/api/cathode/endpoint/{endpoint_id}/genres")
async def cathode_endpoint_genres(
    endpoint_id: str,
    limit: int = Query(10, ge=1, le=30),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Top genres played on a specific endpoint with hour counts."""
    rows = db.execute(
        """SELECT t.genre,
                  COUNT(*)                              AS play_count,
                  SUM(pe.duration_played_secs)/3600.0  AS hours
           FROM play_events pe
           JOIN tracks t ON t.id = pe.blake3_hash
           WHERE pe.endpoint_id = ? AND t.genre IS NOT NULL
           GROUP BY t.genre
           ORDER BY hours DESC
           LIMIT ?""",
        [endpoint_id, limit],
    ).fetchall()
    return [{"genre": r[0], "play_count": r[1], "hours": round(r[2] or 0, 2)} for r in rows]


@app.get("/api/cathode/endpoint/{endpoint_id}/timeline")
async def cathode_endpoint_timeline(
    endpoint_id: str,
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """Monthly play hours for a specific endpoint — used for burn-in chart."""
    rows = db.execute(
        """SELECT DATE_TRUNC('month', played_at::TIMESTAMP)::VARCHAR AS month,
                  COUNT(*)                              AS play_count,
                  SUM(duration_played_secs)/3600.0     AS hours
           FROM play_events
           WHERE endpoint_id = ?
           GROUP BY DATE_TRUNC('month', played_at::TIMESTAMP)
           ORDER BY month""",
        [endpoint_id],
    ).fetchall()
    return [{"month": r[0], "play_count": r[1], "hours": round(r[2] or 0, 2)} for r in rows]


# --- EQ Profiles ---

class EQProfileRequest(BaseModel):
    album_id:             Optional[str]  = None
    blake3_hash:          Optional[str]  = None
    label:                str
    peq_json:             Optional[str]  = None   # JSON string of PEQ bands
    convolution_file_path: Optional[str] = None
    notes:                Optional[str]  = None


@app.get("/api/eq-profiles")
async def list_eq_profiles(
    album_id:    Optional[str] = Query(None),
    blake3_hash: Optional[str] = Query(None),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    if album_id:
        rows = db.execute(
            "SELECT id, blake3_hash, album_id, label, peq_json, convolution_file_path, notes, created_at FROM eq_profiles WHERE album_id = ? ORDER BY created_at DESC",
            [album_id],
        ).fetchall()
    elif blake3_hash:
        rows = db.execute(
            "SELECT id, blake3_hash, album_id, label, peq_json, convolution_file_path, notes, created_at FROM eq_profiles WHERE blake3_hash = ? ORDER BY created_at DESC",
            [blake3_hash],
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, blake3_hash, album_id, label, peq_json, convolution_file_path, notes, created_at FROM eq_profiles ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
    cols = ["id", "blake3_hash", "album_id", "label", "peq_json",
            "convolution_file_path", "notes", "created_at"]
    return [dict(zip(cols, r)) for r in rows]


@app.post("/api/eq-profiles", status_code=201)
async def create_eq_profile(
    req: EQProfileRequest,
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    import uuid
    from datetime import datetime, timezone
    new_id = str(uuid.uuid4())
    # EQ profiles table lives in DuckDB — need write connection
    wdb = duckdb.connect(DB_PATH)
    try:
        wdb.execute(
            """INSERT INTO eq_profiles
               (id, blake3_hash, album_id, label, peq_json, convolution_file_path, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [new_id, req.blake3_hash, req.album_id, req.label,
             req.peq_json, req.convolution_file_path, req.notes,
             datetime.now(timezone.utc).isoformat()],
        )
    finally:
        wdb.close()
    return {"id": new_id}


@app.delete("/api/eq-profiles/{profile_id}", status_code=204)
async def delete_eq_profile(profile_id: str):
    wdb = duckdb.connect(DB_PATH)
    try:
        wdb.execute("DELETE FROM eq_profiles WHERE id = ?", [profile_id])
    finally:
        wdb.close()


# --- Acoustic Fingerprint Deduplication ---

@app.get("/api/dedup/candidates")
async def dedup_candidates(
    similarity_floor: float = Query(0.998, ge=0.9, le=1.0),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    """
    Find pairs of tracks that are likely acoustically identical based on
    matching duration and near-identical semantic embeddings.
    Returns groups keyed by the track with the largest file size (preferred copy).
    """
    semantic_db_path = os.getenv("SEMANTIC_DB", "/data/semantic.db")
    if not os.path.exists(semantic_db_path):
        return []

    sconn = sqlite3.connect(semantic_db_path)
    emb_rows = sconn.execute(
        "SELECT blake3_hash, bpm, spectral_centroid, rms_energy, duration_seconds, vector FROM embeddings"
    ).fetchall()
    sconn.close()

    if len(emb_rows) < 2:
        return []

    # Unpack vectors
    vectors = {}
    meta    = {}
    for row in emb_rows:
        h = row[0]
        n = (len(row[5])) // 4
        vec = list(struct.unpack(f"{n}f", row[5]))
        vectors[h] = vec
        meta[h] = {"bpm": row[1], "centroid": row[2], "energy": row[3], "duration": row[4]}

    hashes = list(vectors.keys())

    def cosine(a, b):
        dot = sum(x * y for x, y in zip(a, b))
        return dot  # pre-normalised

    # Compare same-duration buckets (within 2s) to limit O(n²)
    from collections import defaultdict
    duration_buckets: dict[int, list[str]] = defaultdict(list)
    for h in hashes:
        if meta[h]["duration"]:
            bucket = round(meta[h]["duration"] / 2)
            duration_buckets[bucket].append(h)

    pairs = []
    seen = set()
    for bucket_hashes in duration_buckets.values():
        for i in range(len(bucket_hashes)):
            for j in range(i + 1, len(bucket_hashes)):
                a, b = bucket_hashes[i], bucket_hashes[j]
                if (a, b) in seen or (b, a) in seen:
                    continue
                sim = cosine(vectors[a], vectors[b])
                if sim >= similarity_floor:
                    pairs.append((a, b, round(sim, 6)))
                    seen.add((a, b))

    if not pairs:
        return []

    # Enrich with track info from DuckDB
    all_hashes = list({h for p in pairs for h in (p[0], p[1])})
    placeholders = ",".join(["?"] * len(all_hashes))
    track_rows = db.execute(
        f"SELECT id, title, artist, album, format, bit_depth, size_bytes, path FROM tracks WHERE id IN ({placeholders})",
        all_hashes,
    ).fetchall()
    track_info = {r[0]: dict(zip(["id","title","artist","album","format","bit_depth","size_bytes","path"], r)) for r in track_rows}

    results = []
    for a, b, sim in sorted(pairs, key=lambda x: -x[2]):
        ta = track_info.get(a, {"id": a})
        tb = track_info.get(b, {"id": b})
        # Preferred = larger file (more lossless)
        preferred, duplicate = (ta, tb) if (ta.get("size_bytes") or 0) >= (tb.get("size_bytes") or 0) else (tb, ta)
        results.append({
            "similarity": sim,
            "preferred":  preferred,
            "duplicate":  duplicate,
        })

    return results[:200]
