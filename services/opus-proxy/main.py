"""
Opus Proxy — transparent 128kbps Opus transcoder for remote streaming.

Subscribes to: phonolith.hash.created  (Bit-Forge)
Publishes to:  phonolith.analysis.proxy

For every new track, FFmpeg transcodes the source audio to 128kbps Opus
and writes the result to PROXY_DIR/<blake3_hash>.opus. The API then serves
these files directly when the request carries X-Remote: true or the
?proxy=1 query param, keeping the 'golden copy' untouched.

Play counts and Last-Played timestamps are written via the same
phonolith.playback.* events regardless of which version was served,
keeping analytics consistent.
"""

import asyncio
import json
import os
import subprocess
from pathlib import Path

from loguru import logger
import nats

NATS_URL   = os.getenv("NATS_URL",   "nats://localhost:4222")
PROXY_DIR  = os.getenv("PROXY_DIR",  "/data/proxies")
BITRATE    = os.getenv("OPUS_BITRATE", "128k")
WORKERS    = int(os.getenv("WORKER_POOL_SIZE", "2"))

# Semaphore to cap concurrent FFmpeg processes
_sem: asyncio.Semaphore


def _ffmpeg_transcode(src: str, dst: str, bitrate: str) -> None:
    """Blocking FFmpeg call — run in executor."""
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-vn",                    # drop video/cover art streams
        "-c:a", "libopus",
        "-b:a", bitrate,
        "-application", "audio",  # optimise for music (not voice/VOIP)
        "-ar", "48000",           # Opus native sample rate
        "-ac", "2",               # stereo
        dst,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr[-500:]}")


async def process(path: str, blake3_hash: str, nc) -> None:
    proxy_dir = Path(PROXY_DIR)
    proxy_dir.mkdir(parents=True, exist_ok=True)
    dst = proxy_dir / f"{blake3_hash}.opus"

    if dst.exists():
        logger.info(f"Proxy cache hit {blake3_hash[:12]}…")
        return

    async with _sem:
        logger.info(f"Transcoding → {BITRATE} Opus: {path}")
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None, _ffmpeg_transcode, path, str(dst), BITRATE
            )
        except Exception as e:
            logger.error(f"Transcode failed for {path}: {e}")
            dst.unlink(missing_ok=True)
            return

    size_kb = dst.stat().st_size // 1024
    logger.info(f"Proxy ready: {dst.name} ({size_kb} KB)")

    event = {
        "blake3_hash": blake3_hash,
        "path": path,
        "proxy_path": str(dst),
        "bitrate": BITRATE,
        "format": "opus",
    }
    await nc.publish("phonolith.analysis.proxy", json.dumps(event).encode())


async def main() -> None:
    global _sem
    _sem = asyncio.Semaphore(WORKERS)

    logger.info(f"Opus Proxy starting — bitrate={BITRATE} workers={WORKERS}")

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
            asyncio.create_task(process(path, blake3_hash, nc))

    await nc.subscribe("phonolith.hash.created", cb=handler)
    logger.info(f"Listening on phonolith.hash.created")

    try:
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    finally:
        await nc.drain()


if __name__ == "__main__":
    asyncio.run(main())
