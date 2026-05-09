"""
Semantic — acoustic embedding engine for vector-based similarity search.

Subscribes to: phonolith.hash.created
Publishes to:  phonolith.analysis.semantic

Extracts a 137-dimensional acoustic feature vector per track using librosa:
  - 20 MFCCs (mean + std)              → timbre fingerprint
  - 12 Chroma features (mean + std)    → harmonic / key profile
  - Spectral centroid, bandwidth,
    rolloff, zero-crossing rate        → brightness / noisiness
  - Tempo (BPM)                        → energy / danceability
  - RMS energy                         → loudness proxy

Vectors are L2-normalised and stored in SQLite (DATA_DIR/semantic.db) as
BLOB columns. The API performs cosine similarity (dot product on normalised
vectors) in Python — fast enough for libraries up to ~100k tracks without
a dedicated vector DB.

Attributes stored alongside the vector allow structured filtering:
  bpm, key_index (0-11), spectral_centroid, rms_energy, duration_seconds
"""

import asyncio
import json
import os
import sqlite3
import struct
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import librosa
from loguru import logger
import nats

NATS_URL  = os.getenv("NATS_URL",  "nats://localhost:4222")
DATA_DIR  = os.getenv("DATA_DIR",  "/data")
WORKERS   = int(os.getenv("WORKER_POOL_SIZE", "2"))
DB_PATH   = os.path.join(DATA_DIR, "semantic.db")

FEATURE_DIM = 137


# ── DB helpers ────────────────────────────────────────────────────────────────

def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            blake3_hash   TEXT PRIMARY KEY,
            path          TEXT,
            vector        BLOB NOT NULL,
            bpm           REAL,
            key_index     INTEGER,
            spectral_centroid REAL,
            rms_energy    REAL,
            duration_seconds REAL,
            computed_at   TEXT
        )
    """)
    conn.commit()
    return conn


def pack_vector(v: np.ndarray) -> bytes:
    return struct.pack(f"{len(v)}f", *v.astype(np.float32))


def unpack_vector(blob: bytes) -> np.ndarray:
    n = len(blob) // 4
    return np.array(struct.unpack(f"{n}f", blob), dtype=np.float32)


# ── Feature extraction (runs in ProcessPoolExecutor) ─────────────────────────

def extract_features(path: str) -> dict:
    y, sr = librosa.load(path, sr=None, mono=True, duration=90)  # first 90s

    # MFCCs
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
    mfcc_mean = mfcc.mean(axis=1)
    mfcc_std  = mfcc.std(axis=1)

    # Chroma
    chroma = librosa.feature.chroma_stft(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    chroma_std  = chroma.std(axis=1)

    # Spectral features
    cent   = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    bw     = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)[0]
    zcr    = librosa.feature.zero_crossing_rate(y)[0]
    rms    = librosa.feature.rms(y=y)[0]

    spectral = np.array([
        cent.mean(), cent.std(),
        bw.mean(), bw.std(),
        rolloff.mean(), rolloff.std(),
        zcr.mean(), zcr.std(),
        rms.mean(), rms.std(),
    ])

    # Tempo
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo_val = float(tempo) if np.isscalar(tempo) else float(tempo[0])

    # Key (chromagram argmax)
    key_index = int(chroma_mean.argmax())

    # Assemble and L2-normalise
    vector = np.concatenate([mfcc_mean, mfcc_std, chroma_mean, chroma_std, spectral, [tempo_val]])
    norm = np.linalg.norm(vector)
    if norm > 0:
        vector = vector / norm

    return {
        "vector":            vector,
        "bpm":               tempo_val,
        "key_index":         key_index,
        "spectral_centroid": float(cent.mean()),
        "rms_energy":        float(rms.mean()),
        "duration_seconds":  float(len(y) / sr),
    }


# ── Process one track ─────────────────────────────────────────────────────────

async def process(path: str, blake3_hash: str, pool: ProcessPoolExecutor, conn: sqlite3.Connection, nc) -> None:
    existing = conn.execute(
        "SELECT 1 FROM embeddings WHERE blake3_hash = ?", [blake3_hash]
    ).fetchone()
    if existing:
        logger.info(f"Embedding cache hit {blake3_hash[:12]}…")
        return

    logger.info(f"Extracting features: {path}")
    loop = asyncio.get_event_loop()
    try:
        feats = await loop.run_in_executor(pool, extract_features, path)
    except Exception as e:
        logger.error(f"Feature extraction failed for {path}: {e}")
        return

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """INSERT OR REPLACE INTO embeddings
           (blake3_hash, path, vector, bpm, key_index,
            spectral_centroid, rms_energy, duration_seconds, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        [
            blake3_hash, path,
            pack_vector(feats["vector"]),
            feats["bpm"], feats["key_index"],
            feats["spectral_centroid"], feats["rms_energy"],
            feats["duration_seconds"], now,
        ],
    )
    conn.commit()
    logger.info(f"Embedding stored for {blake3_hash[:12]}… BPM={feats['bpm']:.1f} key={feats['key_index']}")

    event = {
        "blake3_hash":      blake3_hash,
        "path":             path,
        "bpm":              feats["bpm"],
        "key_index":        feats["key_index"],
        "spectral_centroid": feats["spectral_centroid"],
        "rms_energy":       feats["rms_energy"],
        "duration_seconds": feats["duration_seconds"],
        "computed_at":      now,
    }
    await nc.publish("phonolith.analysis.semantic", json.dumps(event).encode())


# ── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = init_db(DB_PATH)
    pool = ProcessPoolExecutor(max_workers=WORKERS)

    logger.info(f"Semantic starting — {FEATURE_DIM}-dim embeddings, workers={WORKERS}")

    nc = await nats.connect(NATS_URL)
    logger.info(f"Connected to NATS at {NATS_URL}")

    async def handler(msg):
        try:
            ev = json.loads(msg.data)
        except Exception as e:
            logger.warning(f"Deserialize error: {e}")
            return
        path        = ev.get("path", "")
        blake3_hash = ev.get("blake3_hash", "")
        if path and blake3_hash:
            asyncio.create_task(process(path, blake3_hash, pool, conn, nc))

    await nc.subscribe("phonolith.hash.created", cb=handler)
    logger.info("Listening on phonolith.hash.created")

    try:
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    finally:
        await nc.drain()
        pool.shutdown(wait=False)
        conn.close()


if __name__ == "__main__":
    asyncio.run(main())
