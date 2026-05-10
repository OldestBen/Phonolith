"""
Engram — metadata lock engine and tag version-control guardian.

Pipeline position: Bit-Forge → Engram → (publishes) → Lexicon

On every new BLAKE3 hash event, Engram:
  1. Reads the full tag payload from the file via mutagen.
  2. Stores it as a versioned snapshot in its SQLite journal, keyed by hash.
  3. If a restore is requested, injects a prior snapshot's tags back into the
     file on the share — without touching the audio stream.
"""

import asyncio
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

import mutagen
from loguru import logger
import nats
from nats.errors import TimeoutError as NatsTimeout

NATS_URL    = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR    = os.getenv("DATA_DIR", "/data")
LIBRARY_PATH = os.getenv("LIBRARY_PATH", "/library")
DB_PATH     = os.path.join(DATA_DIR, "engram.db")

# ── Database ──────────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tag_snapshots (
            id              TEXT PRIMARY KEY,
            blake3_hash     TEXT NOT NULL,
            path            TEXT NOT NULL,
            snapshot_at     TEXT NOT NULL,
            triggered_by    TEXT NOT NULL,
            tags_json       TEXT NOT NULL,
            is_restore_point INTEGER DEFAULT 0,
            restore_label   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_snap_hash ON tag_snapshots(blake3_hash);
        CREATE INDEX IF NOT EXISTS idx_snap_path ON tag_snapshots(path);

        CREATE TABLE IF NOT EXISTS locked_fields (
            blake3_hash TEXT NOT NULL,
            field_name  TEXT NOT NULL,
            locked_value TEXT,
            locked_at   TEXT NOT NULL,
            PRIMARY KEY (blake3_hash, field_name)
        );
    """)
    conn.commit()
    return conn

# ── Tag I/O ───────────────────────────────────────────────────────────────────

def read_all_tags(path: str) -> dict:
    tags: dict = {}
    try:
        audio = mutagen.File(path, easy=False)
        if audio is None:
            return tags
        if audio.tags:
            for key, val in audio.tags.items():
                tags[key] = [str(v) for v in val] if isinstance(val, list) else str(val)
        if hasattr(audio, "info"):
            i = audio.info
            tags["_length"]      = str(getattr(i, "length", ""))
            tags["_bitrate"]     = str(getattr(i, "bitrate", ""))
            tags["_sample_rate"] = str(getattr(i, "sample_rate", ""))
            tags["_channels"]    = str(getattr(i, "channels", ""))
    except Exception as exc:
        logger.warning(f"Could not read tags from {path}: {exc}")
    return tags

def write_tags(path: str, tags: dict) -> bool:
    """Write a tag snapshot back to the file (restore operation)."""
    try:
        audio = mutagen.File(path, easy=False)
        if audio is None:
            return False
        for key, val in tags.items():
            if key.startswith("_"):  # skip _info_ fields
                continue
            try:
                audio.tags[key] = val
            except Exception:
                pass
        audio.save()
        return True
    except Exception as exc:
        logger.error(f"Failed to write tags to {path}: {exc}")
        return False

# ── Snapshot logic ────────────────────────────────────────────────────────────

def take_snapshot(
    db: sqlite3.Connection,
    blake3_hash: str,
    path: str,
    triggered_by: str,
    is_restore_point: bool = False,
    restore_label: str | None = None,
) -> str:
    tags = read_all_tags(path)
    snapshot_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO tag_snapshots
           (id, blake3_hash, path, snapshot_at, triggered_by,
            tags_json, is_restore_point, restore_label)
           VALUES (?,?,?,?,?,?,?,?)""",
        (snapshot_id, blake3_hash, path, now, triggered_by,
         json.dumps(tags), int(is_restore_point), restore_label),
    )
    db.commit()
    logger.info(f"Snapshot {snapshot_id[:8]}… for {Path(path).name} (triggered by: {triggered_by})")
    return snapshot_id

def restore_to_snapshot(
    db: sqlite3.Connection, snapshot_id: str
) -> tuple[bool, str]:
    row = db.execute(
        "SELECT blake3_hash, path, tags_json FROM tag_snapshots WHERE id=?",
        (snapshot_id,),
    ).fetchone()
    if not row:
        return False, "Snapshot not found"
    blake3_hash, path, tags_json = row
    tags = json.loads(tags_json)
    ok = write_tags(path, tags)
    if ok:
        # Record the restoration as a new snapshot
        take_snapshot(db, blake3_hash, path, "restore", restore_label=f"Restored from {snapshot_id[:8]}")
        logger.success(f"Restored {Path(path).name} to snapshot {snapshot_id[:8]}")
    return ok, "" if ok else "write_tags failed"

# ── Message handlers ──────────────────────────────────────────────────────────

async def handle_hash_event(msg, js, db: sqlite3.Connection):
    await msg.ack()
    try:
        data = json.loads(msg.data)
        blake3_hash = data.get("blake3_hash", "")
        path = data.get("path", "")
        event_type = data.get("event_type", "")

        if not blake3_hash or event_type == "deleted":
            return

        loop = asyncio.get_event_loop()
        snapshot_id = await loop.run_in_executor(
            None,
            lambda: take_snapshot(
                db, blake3_hash, path, "ingestion",
                is_restore_point=True,
                restore_label="Initial ingestion",
            ),
        )

        await js.publish(
            "phonolith.metadata.snapshot",
            json.dumps({
                "blake3_hash": blake3_hash,
                "path": path,
                "snapshot_id": snapshot_id,
                "event_type": event_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }).encode(),
        )
    except Exception as exc:
        logger.error(f"handle_hash_event error: {exc}")

async def handle_restore_request(msg, db: sqlite3.Connection):
    """
    Responds to restore requests published on phonolith.engram.restore.
    Payload: { "snapshot_id": "uuid" }
    """
    await msg.ack()
    try:
        data = json.loads(msg.data)
        snapshot_id = data.get("snapshot_id", "")
        ok, reason = await asyncio.get_event_loop().run_in_executor(
            None, lambda: restore_to_snapshot(db, snapshot_id)
        )
        if not ok:
            logger.error(f"Restore failed: {reason}")
    except Exception as exc:
        logger.error(f"handle_restore_request error: {exc}")

# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    db = init_db()
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()

    logger.info("Engram starting — metadata guardian online")

    # Ensure output stream exists
    try:
        await js.add_stream(
            name="PHONOLITH_METADATA",
            subjects=["phonolith.metadata.>"],
            retention="workqueue",
            max_age=86400,
        )
    except Exception:
        pass

    async def _cb_hash(m):
        await handle_hash_event(m, js, db)

    async def _cb_restore(m):
        await handle_restore_request(m, db)

    await js.subscribe("phonolith.hash.created", durable="engram-created", cb=_cb_hash)
    await js.subscribe("phonolith.hash.modified", durable="engram-modified", cb=_cb_hash)

    # Restore requests arrive as core NATS (not JetStream) for low latency
    await nc.subscribe("phonolith.engram.restore", cb=_cb_restore)

    logger.info("Engram ready — tag journal armed, restore endpoint live")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Engram shutting down")
