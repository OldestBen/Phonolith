"""
AccurateRip service.

Pipeline:
  phonolith.hash.created  →  compute CRC32 v1+v2 for FLAC/WAV/AIFF tracks
                             store in local SQLite (accuraterip.db)
                             publish phonolith.analysis.accuraterip

  phonolith.accuraterip.verify  →  given a blake3_hash + musicbrainz_release_id,
                                    fetch AccurateRip disc data and cross-check CRC

AccurateRip CRC32 v1:
  crc = sum(sample[i] * (i+1)) mod 2^32   (samples as unsigned 32-bit ints)

AccurateRip CRC32 v2 (corrected offset):
  Differs by a global track-position multiplicative factor; requires full disc context.
  We compute v1 only for single-track verification.
"""

import asyncio, json, os, sqlite3, struct
from datetime import datetime, timezone
from loguru import logger

import numpy as np
import soundfile as sf
import aiohttp
import nats

NATS_URL  = os.getenv("NATS_URL",  "nats://localhost:4222")
DATA_DIR  = os.getenv("DATA_DIR",  "/data")
DB_PATH   = os.path.join(DATA_DIR, "accuraterip.db")

LOSSLESS_FORMATS = {".flac", ".wav", ".aiff", ".aif", ".ape", ".wv", ".alac"}


# ── SQLite init ────────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS checksums (
            blake3_hash  TEXT PRIMARY KEY,
            crc32_v1     INTEGER,
            sample_count INTEGER,
            computed_at  TEXT,
            ar_result    TEXT DEFAULT 'unknown'   -- unknown|match|no_match
        )
    """)
    conn.commit()
    return conn


# ── CRC32 computation ──────────────────────────────────────────────────────────

def compute_crc32_v1(path: str) -> tuple[int, int] | None:
    """
    Return (crc32_v1, sample_count) for a lossless audio file, or None on error.
    Uses vectorised numpy to keep this reasonably fast.
    """
    try:
        data, _sr = sf.read(path, dtype="int32", always_2d=True)
        # Mix to mono (left+right)/2 for stereo, or use single channel
        if data.shape[1] >= 2:
            samples = ((data[:, 0].astype(np.int64) + data[:, 1].astype(np.int64)) // 2).astype(np.uint32)
        else:
            samples = data[:, 0].astype(np.uint32)

        n = len(samples)
        if n == 0:
            return None

        # crc = Σ(sample[i] * (i+1)) mod 2^32
        indices = np.arange(1, n + 1, dtype=np.uint64)
        crc = int(np.sum(samples.astype(np.uint64) * indices, dtype=np.uint64) & np.uint64(0xFFFFFFFF))
        return crc, n
    except Exception as e:
        logger.warning(f"CRC32 computation failed for {path}: {e}")
        return None


# ── AccurateRip HTTP lookup ────────────────────────────────────────────────────

async def lookup_accuraterip(disc_id_hex: str, track_count: int, freedb_id_hex: str) -> bytes | None:
    """
    Fetch the AccurateRip binary data for a disc.
    URL format: http://www.accuraterip.com/accuraterip/[d1]/[d2]/[d3]/dBAR-[n]-[discid]-[freedbid].bin
    """
    d1 = disc_id_hex[0]
    d2 = disc_id_hex[1]
    d3 = disc_id_hex[2]
    url = (
        f"http://www.accuraterip.com/accuraterip/{d1}/{d2}/{d3}/"
        f"dBAR-{track_count:03d}-{disc_id_hex}-{freedb_id_hex}.bin"
    )
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    return await resp.read()
                logger.debug(f"AccurateRip HTTP {resp.status} for {url}")
                return None
    except Exception as e:
        logger.warning(f"AccurateRip fetch error: {e}")
        return None


def parse_ar_response(data: bytes) -> list[list[int]]:
    """
    Parse the binary AccurateRip response.
    Header per disc: 1 byte track_count, 4 bytes disc_id, 4 bytes freedb_id
    Per track: 1 byte confidence, 4 bytes CRC v1, 4 bytes CRC v2
    Returns list of [confidence, crc_v1, crc_v2] per track, per disc instance.
    """
    results = []
    pos = 0
    while pos < len(data):
        if pos + 9 > len(data):
            break
        track_count = data[pos]
        pos += 9  # skip track_count + disc_id + freedb_id
        disc_tracks = []
        for _ in range(track_count):
            if pos + 9 > len(data):
                break
            conf = data[pos]
            crc_v1 = struct.unpack_from("<I", data, pos + 1)[0]
            crc_v2 = struct.unpack_from("<I", data, pos + 5)[0]
            disc_tracks.append([conf, crc_v1, crc_v2])
            pos += 9
        results.extend(disc_tracks)
    return results


# ── NATS handlers ──────────────────────────────────────────────────────────────

async def handle_hash_created(msg, nc: nats.aio.client.Client, db: sqlite3.Connection):
    """Compute CRC32 for newly ingested lossless tracks."""
    try:
        data = json.loads(msg.data.decode())
        blake3_hash = data.get("blake3_hash", "")
        path        = data.get("path", "")
        fmt         = (data.get("format") or "").lower()

        ext = os.path.splitext(path)[1].lower()
        if ext not in LOSSLESS_FORMATS and fmt not in {f.lstrip(".") for f in LOSSLESS_FORMATS}:
            return

        result = await asyncio.get_event_loop().run_in_executor(
            None, compute_crc32_v1, path
        )
        if result is None:
            return

        crc, sample_count = result
        now = datetime.now(timezone.utc).isoformat()

        db.execute(
            """INSERT OR REPLACE INTO checksums (blake3_hash, crc32_v1, sample_count, computed_at)
               VALUES (?, ?, ?, ?)""",
            [blake3_hash, crc, sample_count, now],
        )
        db.commit()

        logger.info(f"AccurateRip CRC32 v1={crc:#010x} for {blake3_hash[:12]}…")

        await nc.publish("phonolith.analysis.accuraterip", json.dumps({
            "blake3_hash": blake3_hash,
            "crc32_v1":    crc,
            "ar_result":   "unknown",  # can only verify with full disc context
        }).encode())
    except Exception as e:
        logger.exception(f"handle_hash_created error: {e}")


async def handle_verify_request(msg, nc: nats.aio.client.Client, db: sqlite3.Connection):
    """
    Verify a set of tracks against AccurateRip.
    Payload: {disc_id, freedb_id, track_count, tracks: [{blake3_hash, track_number}]}
    """
    try:
        payload      = json.loads(msg.data.decode())
        disc_id      = payload.get("disc_id", "")       # hex string
        freedb_id    = payload.get("freedb_id", "")     # hex string
        track_count  = payload.get("track_count", 0)
        tracks       = payload.get("tracks", [])        # [{blake3_hash, track_number}]

        if not disc_id or not tracks:
            return

        ar_data = await lookup_accuraterip(disc_id, track_count, freedb_id)
        if ar_data is None:
            logger.info(f"AccurateRip: no data for disc {disc_id}")
            return

        ar_entries = parse_ar_response(ar_data)
        # ar_entries is ordered by track; index 0 = track 1

        for t in tracks:
            hash_    = t.get("blake3_hash", "")
            track_no = t.get("track_number", 1) - 1  # 0-indexed

            local_row = db.execute(
                "SELECT crc32_v1 FROM checksums WHERE blake3_hash = ?", [hash_]
            ).fetchone()
            if not local_row:
                continue

            local_crc = local_row[0]

            # Find matching CRC in AR response for this track position
            matched = False
            for entry in ar_entries:
                if track_no < len(ar_entries) and ar_entries[track_no][1] == local_crc:
                    matched = True
                    break

            result = "match" if matched else "no_match"
            db.execute(
                "UPDATE checksums SET ar_result = ? WHERE blake3_hash = ?", [result, hash_]
            )
            db.commit()

            logger.info(f"AccurateRip {hash_[:12]}… track {track_no+1}: {result}")

            await nc.publish("phonolith.analysis.accuraterip", json.dumps({
                "blake3_hash": hash_,
                "crc32_v1":    local_crc,
                "ar_result":   result,
            }).encode())

    except Exception as e:
        logger.exception(f"handle_verify_request error: {e}")


async def main():
    logger.info("AccurateRip service starting")
    os.makedirs(DATA_DIR, exist_ok=True)
    db = init_db()

    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    await nc.subscribe(
        "phonolith.hash.created",
        cb=lambda m: asyncio.create_task(handle_hash_created(m, nc, db)),
    )
    await nc.subscribe(
        "phonolith.accuraterip.verify",
        cb=lambda m: asyncio.create_task(handle_verify_request(m, nc, db)),
    )

    logger.info("AccurateRip service ready — computing CRC32 v1 for new lossless tracks")
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
