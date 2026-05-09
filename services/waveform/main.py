"""
Waveform — per-track peak/RMS waveform renderer.

Subscribes to: phonolith.hash.created  (Bit-Forge)
Publishes to:  phonolith.analysis.waveform

Divides a decoded audio file into RESOLUTION buckets, computes per-bucket
peak (max absolute sample) and RMS across all channels, serialises the result
as JSON, and caches it on disk under DATA_DIR/<blake3_hash>.json so
subsequent requests are served from cache without re-decoding.
"""

import asyncio
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf
from loguru import logger
import nats

NATS_URL   = os.getenv("NATS_URL",   "nats://localhost:4222")
DATA_DIR   = os.getenv("DATA_DIR",   "/data/waveforms")
RESOLUTION = int(os.getenv("WAVEFORM_RESOLUTION", "1800"))  # data points per track
WORKERS    = int(os.getenv("WORKER_POOL_SIZE", "2"))


def _compute_waveform(path: str, resolution: int) -> dict:
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    # Mix to mono for display
    mono = data.mean(axis=1)
    total = len(mono)

    peaks = []
    rmses = []
    bucket_size = max(1, total // resolution)

    for i in range(resolution):
        start = i * bucket_size
        end   = min(start + bucket_size, total)
        if start >= total:
            peaks.append(0.0)
            rmses.append(0.0)
            continue
        chunk = mono[start:end]
        peaks.append(float(np.max(np.abs(chunk))))
        rmses.append(float(np.sqrt(np.mean(chunk ** 2))))

    return {
        "resolution": resolution,
        "sample_rate": sr,
        "duration_seconds": total / sr,
        "peaks": peaks,
        "rms":   rmses,
    }


async def process(path: str, blake3_hash: str, pool: ProcessPoolExecutor, nc) -> None:
    cache_dir  = Path(DATA_DIR)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{blake3_hash}.json"

    if cache_file.exists():
        logger.info(f"Waveform cache hit for {blake3_hash[:12]}…")
        payload = cache_file.read_bytes()
    else:
        logger.info(f"Computing waveform for {path}")
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                pool, _compute_waveform, path, RESOLUTION
            )
        except Exception as e:
            logger.error(f"Waveform compute failed for {path}: {e}")
            return

        result["blake3_hash"] = blake3_hash
        result["path"]        = path
        payload               = json.dumps(result).encode()
        cache_file.write_bytes(payload)
        logger.info(f"Waveform cached → {cache_file}")

    await nc.publish("phonolith.analysis.waveform", payload)


async def main() -> None:
    logger.info("Waveform starting")
    pool = ProcessPoolExecutor(max_workers=WORKERS)

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
        if not path or not blake3_hash:
            return
        asyncio.create_task(process(path, blake3_hash, pool, nc))

    await nc.subscribe("phonolith.hash.created", cb=handler)
    logger.info(f"Listening on phonolith.hash.created (resolution={RESOLUTION})")

    try:
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    finally:
        await nc.drain()
        pool.shutdown(wait=False)


if __name__ == "__main__":
    asyncio.run(main())
