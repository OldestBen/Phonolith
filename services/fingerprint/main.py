"""
Acoustic Fingerprint Service
Generates AcoustID/Chromaprint fingerprints for tracks and stores them in SQLite.
Can compare two tracks to determine if they are acoustically identical or similar.
Listens on NATS phonolith.hash.new for auto-fingerprinting new tracks.
"""
import asyncio, json, os, sqlite3, subprocess, struct
from loguru import logger
import nats

NATS_URL     = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR     = os.getenv("DATA_DIR", "/data")
LIBRARY_PATH = os.getenv("LIBRARY_PATH", "/library")
FP_DB        = os.path.join(DATA_DIR, "fingerprints.db")


# ── Database ──────────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(FP_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fingerprints (
            blake3_hash     TEXT PRIMARY KEY,
            path            TEXT NOT NULL,
            duration        REAL,
            fingerprint     TEXT NOT NULL,
            computed_at     TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def open_db() -> sqlite3.Connection:
    return sqlite3.connect(FP_DB)


# ── Chromaprint ───────────────────────────────────────────────────────────────

def compute_fingerprint(path: str) -> tuple[float, str] | None:
    """Run fpcalc (chromaprint CLI) and return (duration, fingerprint_string)."""
    try:
        result = subprocess.run(
            ["fpcalc", "-raw", path],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            logger.warning(f"fpcalc failed for {path}: {result.stderr.strip()}")
            return None
        dur = None
        fp = None
        for line in result.stdout.splitlines():
            if line.startswith("DURATION="):
                dur = float(line.split("=", 1)[1])
            elif line.startswith("FINGERPRINT="):
                fp = line.split("=", 1)[1]
        if dur is None or fp is None:
            return None
        return dur, fp
    except FileNotFoundError:
        logger.error("fpcalc not found — install libchromaprint-tools")
        return None
    except Exception as e:
        logger.exception(f"fpcalc error for {path}: {e}")
        return None


def _fp_to_ints(fp_str: str) -> list[int]:
    """Decode raw fingerprint string to list of uint32 integers."""
    import base64
    raw = base64.b64decode(fp_str)
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}I", raw[:n * 4]))


def bit_error_rate(fp_a: str, fp_b: str) -> float:
    """
    Compute the bit error rate (BER) between two Chromaprint fingerprints.
    BER of 0 = acoustically identical. BER < 0.35 = same recording.
    """
    try:
        ints_a = _fp_to_ints(fp_a)
        ints_b = _fp_to_ints(fp_b)
        min_len = min(len(ints_a), len(ints_b))
        if min_len == 0:
            return 1.0
        errors = sum(bin(a ^ b).count("1") for a, b in zip(ints_a[:min_len], ints_b[:min_len]))
        return errors / (min_len * 32)
    except Exception:
        return 1.0


# ── NATS handler ──────────────────────────────────────────────────────────────

async def handle_new_hash(msg):
    """Auto-fingerprint a newly ingested track."""
    try:
        payload = json.loads(msg.data.decode())
        blake3_hash = payload.get("blake3_hash", "")
        path = payload.get("path", "")
        if not blake3_hash or not path:
            return

        conn = open_db()
        existing = conn.execute(
            "SELECT 1 FROM fingerprints WHERE blake3_hash = ?", [blake3_hash]
        ).fetchone()
        conn.close()
        if existing:
            return

        result = compute_fingerprint(path)
        if result is None:
            return
        dur, fp = result

        from datetime import datetime, timezone
        conn = open_db()
        conn.execute(
            "INSERT OR REPLACE INTO fingerprints (blake3_hash, path, duration, fingerprint, computed_at) VALUES (?, ?, ?, ?, ?)",
            [blake3_hash, path, dur, fp, datetime.now(timezone.utc).isoformat()],
        )
        conn.commit()
        conn.close()
        logger.info(f"Fingerprinted {blake3_hash[:16]}…")
    except Exception as e:
        logger.exception(f"Fingerprint handler error: {e}")


async def main():
    logger.info(f"Fingerprint service starting, connecting to NATS at {NATS_URL}")
    init_db()
    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")
    await nc.subscribe("phonolith.hash.computed", cb=handle_new_hash)
    logger.info("Fingerprint service ready — listening for phonolith.hash.computed")
    while True:
        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(main())
