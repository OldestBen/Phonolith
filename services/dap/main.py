"""
DAP Provisioning Service
Syncs a curated subset of the library to a Digital Audio Player (SD card / USB drive).
Profiles define: target path, storage limit, format caps, and smart-playlist filters.
Triggered via NATS phonolith.dap.sync messages or on a schedule.
"""
import asyncio, json, os, shutil, sqlite3, uuid
from datetime import datetime, timezone
from pathlib import Path
from loguru import logger
import nats

NATS_URL  = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR  = os.getenv("DATA_DIR", "/data")
DAP_DB    = os.path.join(DATA_DIR, "dap.db")


# ── Database ──────────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DAP_DB)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS dap_profiles (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            target_path     TEXT NOT NULL,
            storage_limit_gb REAL NOT NULL DEFAULT 32,
            max_bit_depth   INTEGER,
            max_sample_rate INTEGER,
            filter_genre    TEXT,
            filter_min_rating REAL,
            filter_lossless_only INTEGER NOT NULL DEFAULT 0,
            rotation_policy TEXT NOT NULL DEFAULT 'keep',
            created_at      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dap_sync_log (
            id          TEXT PRIMARY KEY,
            profile_id  TEXT NOT NULL,
            started_at  TEXT NOT NULL,
            finished_at TEXT,
            status      TEXT NOT NULL DEFAULT 'running',
            files_copied INTEGER NOT NULL DEFAULT 0,
            files_removed INTEGER NOT NULL DEFAULT 0,
            bytes_used  INTEGER NOT NULL DEFAULT 0,
            error       TEXT
        );
    """)
    conn.commit()
    return conn


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DAP_DB)
    conn.row_factory = sqlite3.Row
    return conn


# ── Sync logic ────────────────────────────────────────────────────────────────

async def run_sync(profile_id: str, nc) -> None:
    conn = open_db()
    row = conn.execute(
        "SELECT * FROM dap_profiles WHERE id = ?", [profile_id]
    ).fetchone()
    conn.close()

    if not row:
        logger.warning(f"DAP sync: unknown profile {profile_id}")
        return

    profile = dict(row)
    target = Path(profile["target_path"])

    log_id = str(uuid.uuid4())
    db = open_db()
    db.execute(
        """INSERT INTO dap_sync_log (id, profile_id, started_at, status)
           VALUES (?, ?, ?, 'running')""",
        [log_id, profile_id, datetime.now(timezone.utc).isoformat()],
    )
    db.commit()
    db.close()

    logger.info(f"DAP sync start: profile '{profile['name']}' → {target}")

    files_copied = 0
    files_removed = 0
    bytes_used = 0
    error_msg = None

    try:
        if not target.exists():
            logger.warning(f"DAP target path {target} does not exist — creating")
            target.mkdir(parents=True, exist_ok=True)

        limit_bytes = int(profile["storage_limit_gb"] * 1024 ** 3)

        # Build candidate list from NATS/DuckDB via analytics DB
        # We read phonolith.duckdb directly in read-only mode
        import duckdb
        duckdb_path = os.path.join(DATA_DIR, "phonolith.duckdb")
        if not os.path.exists(duckdb_path):
            raise FileNotFoundError("DuckDB not found; library not yet ingested")

        ddb = duckdb.connect(duckdb_path, read_only=True)

        conditions = ["path IS NOT NULL"]
        params = []

        if profile.get("filter_genre"):
            conditions.append("LOWER(genre) LIKE LOWER(?)")
            params.append(f"%{profile['filter_genre']}%")
        if profile.get("filter_min_rating"):
            conditions.append("internal_rating >= ?")
            params.append(profile["filter_min_rating"])
        if profile.get("filter_lossless_only"):
            conditions.append("LOWER(format) IN ('flac', 'alac', 'wav', 'aiff', 'dsf', 'dff')")
        if profile.get("max_bit_depth"):
            conditions.append("(bit_depth IS NULL OR bit_depth <= ?)")
            params.append(profile["max_bit_depth"])
        if profile.get("max_sample_rate"):
            conditions.append("(sample_rate IS NULL OR sample_rate <= ?)")
            params.append(profile["max_sample_rate"])

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        rows = ddb.execute(
            f"SELECT path, title, artist, album FROM tracks {where} ORDER BY artist, album, track_number",
            params,
        ).fetchall()
        ddb.close()

        manifest: set[str] = set()
        used = 0

        for path_str, title, artist, album in rows:
            src = Path(path_str)
            if not src.exists():
                continue
            size = src.stat().st_size
            if used + size > limit_bytes:
                logger.info(f"DAP storage limit reached ({profile['storage_limit_gb']} GB)")
                break

            # Preserve artist/album directory structure
            rel_parts = [
                _safe(artist or "Unknown Artist"),
                _safe(album or "Unknown Album"),
                src.name,
            ]
            dest = target / Path(*rel_parts)
            dest.parent.mkdir(parents=True, exist_ok=True)

            if not dest.exists() or dest.stat().st_size != size:
                shutil.copy2(str(src), str(dest))
                files_copied += 1
                logger.debug(f"Copied {src.name}")

            manifest.add(str(dest))
            used += size
            bytes_used += size

        # Remove files no longer in manifest (rotation)
        if profile.get("rotation_policy") == "prune":
            for existing in target.rglob("*"):
                if existing.is_file() and str(existing) not in manifest:
                    existing.unlink()
                    files_removed += 1

        logger.info(
            f"DAP sync done: {files_copied} copied, {files_removed} removed, "
            f"{bytes_used / 1024**2:.1f} MB used"
        )

    except Exception as e:
        error_msg = str(e)
        logger.exception(f"DAP sync error: {e}")

    db = open_db()
    db.execute(
        """UPDATE dap_sync_log
           SET finished_at=?, status=?, files_copied=?, files_removed=?, bytes_used=?, error=?
           WHERE id=?""",
        [
            datetime.now(timezone.utc).isoformat(),
            "error" if error_msg else "done",
            files_copied, files_removed, bytes_used,
            error_msg, log_id,
        ],
    )
    db.commit()
    db.close()

    await nc.publish("phonolith.dap.sync.done", json.dumps({
        "profile_id": profile_id,
        "log_id": log_id,
        "status": "error" if error_msg else "done",
        "files_copied": files_copied,
        "bytes_used": bytes_used,
    }).encode())


def _safe(s: str) -> str:
    return "".join(c if c.isalnum() or c in " ._-" else "_" for c in s).strip()


# ── NATS handler ──────────────────────────────────────────────────────────────

async def main():
    logger.info(f"DAP provisioning service starting, connecting to NATS at {NATS_URL}")
    init_db()
    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    async def on_sync(msg):
        try:
            payload = json.loads(msg.data.decode())
            profile_id = payload.get("profile_id", "")
            asyncio.create_task(run_sync(profile_id, nc))
        except Exception as e:
            logger.exception(f"DAP sync trigger error: {e}")

    await nc.subscribe("phonolith.dap.sync", cb=on_sync)
    logger.info("DAP service ready — listening for phonolith.dap.sync")

    while True:
        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(main())
