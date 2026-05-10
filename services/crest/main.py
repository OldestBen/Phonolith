"""
Crest — Dynamic Range (DR) calculator.

Subscribes to: phonolith.hash.created  (Bit-Forge)
Publishes to:  phonolith.analysis.crest

Implements the DR Database methodology:
  - Split track into 3-second non-overlapping blocks.
  - Per block: compute Peak = max absolute sample, RMS of that block.
  - DR = 20*log10(RMS_second_highest_peak / RMS_mean).
  - Official DR score = round(mean DR across all blocks).
Also records raw Peak (dBFS) and RMS (dBFS) for version comparison.
"""

import asyncio
import json
import os
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
from loguru import logger
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")
WORKERS  = int(os.getenv("WORKER_POOL_SIZE", "4"))
BLOCK_SECS = 3.0


def compute_dr(path: str) -> dict:
    """DR Database method. Runs in process pool."""
    result = {
        "path": path,
        "dr_score": None,
        "peak_dbfs": None,
        "rms_dbfs": None,
        "crest_factor_db": None,
        "error": None,
    }
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        block_size = int(sr * BLOCK_SECS)
        n_blocks = len(mono) // block_size
        if n_blocks == 0:
            result["error"] = "Track too short for DR measurement"
            return result

        peaks, rmss = [], []
        for i in range(n_blocks):
            block = mono[i * block_size:(i + 1) * block_size]
            peaks.append(np.max(np.abs(block)))
            rmss.append(np.sqrt(np.mean(block ** 2)))

        peaks_sorted = sorted(peaks, reverse=True)
        second_peak = peaks_sorted[1] if len(peaks_sorted) > 1 else peaks_sorted[0]
        rms_mean = np.mean(rmss)

        global_peak = max(peaks)
        dr_blocks = [
            20 * np.log10(peaks_sorted[0] / r) if r > 0 else 0
            for r in rmss
        ]
        dr_score = round(np.mean(dr_blocks))

        result["dr_score"]        = int(dr_score)
        result["peak_dbfs"]       = round(20 * np.log10(global_peak + 1e-12), 2)
        result["rms_dbfs"]        = round(20 * np.log10(rms_mean + 1e-12), 2)
        result["crest_factor_db"] = round(
            20 * np.log10((second_peak + 1e-12) / (rms_mean + 1e-12)), 2
        )
    except Exception as exc:
        result["error"] = str(exc)
        logger.error(f"DR computation failed for {path}: {exc}")
    return result


async def handle_hash_event(msg, js, executor):
    await msg.ack()
    try:
        data = json.loads(msg.data)
        path = data.get("path", "")
        blake3_hash = data.get("blake3_hash", "")
        if not path or not blake3_hash:
            return

        loop = asyncio.get_event_loop()
        dr = await loop.run_in_executor(executor, compute_dr, path)

        event = {
            "blake3_hash": blake3_hash,
            "path": path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **dr,
        }
        await js.publish("phonolith.analysis.crest", json.dumps(event).encode())

        score = dr.get("dr_score")
        logger.info(
            f"Crest: {Path(path).name} → DR{score} "
            f"(peak:{dr.get('peak_dbfs')} dBFS, rms:{dr.get('rms_dbfs')} dBFS)"
        )
    except Exception as exc:
        logger.error(f"handle_hash_event error: {exc}")


async def main():
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()

    logger.info(f"Crest starting — DR calculator (workers={WORKERS})")

    executor = ProcessPoolExecutor(max_workers=WORKERS)

    async def _cb_hash(m):
        await handle_hash_event(m, js, executor)

    await js.subscribe("phonolith.hash.created", durable="crest", cb=_cb_hash)

    logger.info("Crest listening for hash events")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Crest shutting down")
