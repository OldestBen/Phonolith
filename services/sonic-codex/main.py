import asyncio, json, os, sqlite3
from datetime import datetime, timezone
from loguru import logger
import nats
import duckdb

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")
DUCKDB_PATH = os.path.join(DATA_DIR, "phonolith.duckdb")


def table_exists(conn, name: str) -> bool:
    try:
        conn.execute(f"SELECT 1 FROM {name} LIMIT 1")
        return True
    except Exception:
        return False


def export_to_codex(output_path: str) -> dict:
    """Export the DuckDB library to a compressed SQLite .codex file."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # Read from DuckDB
    conn = duckdb.connect(DUCKDB_PATH, read_only=True)
    try:
        tracks = conn.execute(
            "SELECT hash, path, title, artist, album, dr_score, internal_rating "
            "FROM tracks ORDER BY artist, album, title"
        ).fetchall()
        tag_counts = conn.execute(
            "SELECT hash, COUNT(*) as snapshot_count FROM tag_snapshots GROUP BY hash"
        ).fetchall() if table_exists(conn, "tag_snapshots") else []
        play_counts = conn.execute(
            "SELECT hash, COUNT(*) as play_count FROM play_events GROUP BY hash"
        ).fetchall() if table_exists(conn, "play_events") else []
    finally:
        conn.close()

    # Write to SQLite .codex
    codex = sqlite3.connect(output_path)
    codex.execute("PRAGMA journal_mode=WAL")
    codex.execute("""
        CREATE TABLE IF NOT EXISTS tracks (
            hash TEXT PRIMARY KEY, path TEXT, title TEXT, artist TEXT,
            album TEXT, dr_score REAL, internal_rating INTEGER
        )
    """)
    codex.execute("CREATE TABLE IF NOT EXISTS tag_snapshots (hash TEXT, snapshot_count INTEGER)")
    codex.execute("CREATE TABLE IF NOT EXISTS play_events (hash TEXT, play_count INTEGER)")
    codex.execute("CREATE TABLE IF NOT EXISTS codex_meta (key TEXT PRIMARY KEY, value TEXT)")

    codex.executemany("INSERT OR REPLACE INTO tracks VALUES (?,?,?,?,?,?,?)", tracks)
    codex.executemany("INSERT OR REPLACE INTO tag_snapshots VALUES (?,?)", tag_counts)
    codex.executemany("INSERT OR REPLACE INTO play_events VALUES (?,?)", play_counts)
    codex.execute("INSERT OR REPLACE INTO codex_meta VALUES ('exported_at', ?)",
                  [datetime.now(timezone.utc).isoformat()])
    codex.execute("INSERT OR REPLACE INTO codex_meta VALUES ('track_count', ?)", [str(len(tracks))])
    codex.execute("INSERT OR REPLACE INTO codex_meta VALUES ('ghost', '0')")
    codex.commit()
    codex.close()

    logger.info(f"Exported {len(tracks)} tracks to {output_path}")
    return {"status": "ok", "output_path": output_path, "track_count": len(tracks)}


def import_ghost_codex(codex_path: str) -> dict:
    """Import a .codex file as a read-only ghost library overlay."""
    if not os.path.exists(codex_path):
        return {"status": "error", "message": f"Codex file not found: {codex_path}"}

    codex = sqlite3.connect(codex_path)
    try:
        meta = dict(codex.execute("SELECT key, value FROM codex_meta").fetchall())
        track_count = codex.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        sample_tracks = codex.execute(
            "SELECT hash, title, artist, album FROM tracks LIMIT 10"
        ).fetchall()
    except Exception as e:
        codex.close()
        return {"status": "error", "message": str(e)}
    finally:
        codex.close()

    logger.info(f"Imported ghost codex from {codex_path}: {track_count} tracks (read-only overlay)")
    return {
        "status": "ok",
        "codex_path": codex_path,
        "mode": "ghost",
        "track_count": track_count,
        "meta": meta,
        "sample_tracks": sample_tracks,
    }


async def handle_export(msg, nc):
    try:
        payload = json.loads(msg.data.decode())
        output_path = payload.get("output_path", os.path.join(DATA_DIR, "exports/library.codex"))
        result = export_to_codex(output_path)
        await nc.publish("phonolith.codex.exported", json.dumps(result).encode())
    except Exception as e:
        logger.exception(f"Export failed: {e}")
        await nc.publish("phonolith.codex.exported", json.dumps({"status": "error", "message": str(e)}).encode())


async def handle_import(msg, nc):
    try:
        payload = json.loads(msg.data.decode())
        codex_path = payload.get("codex_path")
        mode = payload.get("mode", "ghost")
        if mode != "ghost":
            result = {"status": "error", "message": f"Unsupported import mode: {mode}"}
        else:
            result = import_ghost_codex(codex_path)
        await nc.publish("phonolith.codex.imported", json.dumps(result).encode())
    except Exception as e:
        logger.exception(f"Import failed: {e}")
        await nc.publish("phonolith.codex.imported", json.dumps({"status": "error", "message": str(e)}).encode())


async def main():
    logger.info(f"Sonic Codex starting, connecting to NATS at {NATS_URL}")
    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    async def _cb_export(msg): await handle_export(msg, nc)
    async def _cb_import(msg): await handle_import(msg, nc)

    await nc.subscribe("phonolith.codex.export", cb=_cb_export)
    await nc.subscribe("phonolith.codex.import", cb=_cb_import)
    logger.info("Sonic Codex ready — listening for export/import commands")

    while True:
        await asyncio.sleep(300)
        logger.info("Sonic Codex alive")


if __name__ == "__main__":
    asyncio.run(main())
