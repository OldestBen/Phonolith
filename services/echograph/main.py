"""
EchoGraph — the Last.fm-on-steroids analytics engine.

EchoGraph is the EXCLUSIVE writer to the DuckDB analytics database.
All other services publish events; EchoGraph persists them.

Subscribes to:
  phonolith.hash.*             → ingest new/updated tracks
  phonolith.metadata.enriched  → update track metadata
  phonolith.analysis.prism     → update spectral / fraud flags
  phonolith.analysis.crest     → update DR scores
  phonolith.playback.started   → record play events
  phonolith.vault.uploaded     → record vault objects

The API reads DuckDB in read-only mode for all analytics queries.
"""

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import duckdb
from loguru import logger
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")
DB_PATH  = os.path.join(DATA_DIR, "phonolith.duckdb")
SCHEMA   = "/app/schema.sql"

# ── DB init ───────────────────────────────────────────────────────────────────

def init_db() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect(DB_PATH)
    try:
        with open(SCHEMA) as f:
            conn.executescript(f.read())
    except FileNotFoundError:
        logger.warning("schema.sql not found — tables may be missing")
    return conn

# ── Event handlers ────────────────────────────────────────────────────────────

def upsert_track(conn, data: dict):
    h = data.get("blake3_hash", "")
    path = data.get("path", "")
    if not h or data.get("event_type") == "deleted":
        return
    filename = Path(path).name
    conn.execute(
        """INSERT INTO tracks (id, path, filename, size_bytes, ingested_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             path = excluded.path,
             last_scanned_at = excluded.ingested_at""",
        [h, path, filename, data.get("file_size_bytes", 0),
         datetime.now(timezone.utc).isoformat()],
    )
    conn.execute(
        """INSERT INTO track_hashes (blake3_hash, path, event_type, recorded_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT DO NOTHING""",
        [h, path, data.get("event_type", ""), datetime.now(timezone.utc).isoformat()],
    )

def apply_enriched(conn, data: dict):
    h = data.get("blake3_hash", "")
    if not h:
        return
    updates = []
    vals = []
    for col in ["engineer", "mixer", "mastered_by"]:
        if col in data:
            updates.append(f"{col} = ?")
            vals.append(", ".join(data[col]) if isinstance(data[col], list) else data[col])
    if updates:
        vals.append(h)
        conn.execute(f"UPDATE tracks SET {', '.join(updates)} WHERE id = ?", vals)

def apply_prism(conn, data: dict):
    h = data.get("blake3_hash", "")
    if not h:
        return
    conn.execute(
        """UPDATE tracks SET
             prism_status = ?, prism_fraud_reason = ?,
             spectral_cutoff_hz = ?, spectrogram_path = ?,
             last_analyzed_at = ?
           WHERE id = ?""",
        [data.get("status"), data.get("fraud_reason"),
         data.get("spectral_cutoff_hz"), data.get("spectrogram_path"),
         datetime.now(timezone.utc).isoformat(), h],
    )

def apply_crest(conn, data: dict):
    h = data.get("blake3_hash", "")
    if not h:
        return
    conn.execute(
        """UPDATE tracks SET
             dr_score = ?, peak_level = ?, rms_level = ?, crest_factor = ?,
             last_analyzed_at = ?
           WHERE id = ?""",
        [data.get("dr_score"), data.get("peak_dbfs"),
         data.get("rms_dbfs"), data.get("crest_factor_db"),
         datetime.now(timezone.utc).isoformat(), h],
    )

def record_play(conn, data: dict):
    conn.execute(
        """INSERT INTO play_events
           (id, blake3_hash, played_at, source, endpoint_id, format_played)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [str(uuid.uuid4()), data.get("blake3_hash", ""),
         data.get("timestamp", datetime.now(timezone.utc).isoformat()),
         data.get("source", "lucid"),
         data.get("endpoint_id"), data.get("format")],
    )
    conn.execute(
        "UPDATE tracks SET last_played_at = ? WHERE id = ?",
        [data.get("timestamp"), data.get("blake3_hash")],
    )

def record_vault(conn, data: dict):
    conn.execute(
        """INSERT INTO vault_objects
           (id, blake3_hash, s3_key, tier, uploaded_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING""",
        [str(uuid.uuid4()), data.get("blake3_hash", ""),
         data.get("s3_key", ""), data.get("tier", "hot"),
         datetime.now(timezone.utc).isoformat()],
    )

KEY_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

def apply_semantic(conn, data: dict):
    h = data.get("blake3_hash", "")
    if not h:
        return
    key_index = data.get("key_index")
    detected_key = KEY_NAMES[key_index] if key_index is not None and 0 <= key_index <= 11 else None
    conn.execute(
        """UPDATE tracks SET
             bpm            = COALESCE(bpm, ?),
             initial_key    = COALESCE(initial_key, ?),
             detected_bpm   = ?,
             detected_key   = ?,
             last_analyzed_at = ?
           WHERE id = ?""",
        [
            data.get("bpm"), detected_key,
            data.get("bpm"), detected_key,
            datetime.now(timezone.utc).isoformat(), h,
        ],
    )

ALLOWED_FIX_FIELDS = {
    "title", "artist", "album", "album_artist", "year", "genre", "label",
    "composer", "lyricist", "engineer", "mixer", "mastered_by", "remixed_by",
    "bpm", "initial_key", "track_number", "disc_number",
}

def apply_polyphony_fix(conn, data: dict):
    """Apply a peer-approved metadata correction directly to the tracks table."""
    h      = data.get("blake3_hash", "")
    field  = data.get("field", "")
    value  = data.get("value")
    if not h or field not in ALLOWED_FIX_FIELDS:
        logger.warning(f"Ignored polyphony fix: hash={h!r}, field={field!r}")
        return
    conn.execute(
        f"UPDATE tracks SET {field} = ?, last_analyzed_at = ? WHERE id = ?",
        [value, datetime.now(timezone.utc).isoformat(), h],
    )
    logger.info(f"Applied polyphony fix: {h}/{field} = {value!r}")


HANDLERS = {
    "phonolith.hash.created":           upsert_track,
    "phonolith.hash.modified":          upsert_track,
    "phonolith.hash.deleted":           upsert_track,
    "phonolith.hash.renamed":           upsert_track,
    "phonolith.metadata.enriched":      apply_enriched,
    "phonolith.analysis.prism":         apply_prism,
    "phonolith.analysis.crest":         apply_crest,
    "phonolith.analysis.semantic":      apply_semantic,
    "phonolith.playback.started":       record_play,
    "phonolith.vault.uploaded":         record_vault,
    "phonolith.polyphony.fix.approved": apply_polyphony_fix,
}

async def handle(msg, conn: duckdb.DuckDBPyConnection):
    subject = msg.subject
    await msg.ack()
    try:
        data = json.loads(msg.data)
        handler = HANDLERS.get(subject)
        if handler:
            await asyncio.get_event_loop().run_in_executor(None, handler, conn, data)
    except Exception as exc:
        logger.error(f"EchoGraph error on {subject}: {exc}")

async def main():
    conn = init_db()
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()

    logger.info("EchoGraph starting — analytics engine online (DuckDB writer)")

    for subject, stream in [
        ("phonolith.hash.>",                "PHONOLITH_HASH"),
        ("phonolith.metadata.enriched",     "PHONOLITH_METADATA"),
        ("phonolith.analysis.>",            "PHONOLITH_ANALYSIS"),
        ("phonolith.playback.started",      "PHONOLITH_PLAYBACK"),
        ("phonolith.vault.uploaded",        "PHONOLITH_VAULT"),
        ("phonolith.polyphony.fix.approved","PHONOLITH_POLYPHONY"),
    ]:
        durable = "echograph-" + subject.replace(".", "-").replace(">", "all")
        await js.subscribe(
            subject,
            durable=durable,
            cb=lambda m, c=conn: asyncio.create_task(handle(m, c)),
        )

    logger.info("EchoGraph listening on all pipeline topics")
    await asyncio.Event().wait()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("EchoGraph shutting down")
