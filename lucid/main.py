"""
main.py — Lucid FastAPI application entry point.

Exposes an HTTP API on port 8001 for controlling ALSA exclusive playback,
managing the playback queue, querying signal-path state, and listing
AirPlay endpoints discovered by FluxManager.

Environment variables:
  REDIS_URL      Redis connection URL (default: redis://redis:6379)
  ALSA_DEVICE    Default ALSA device name (default: "default")
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import redis as redis_lib
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from flux import FluxManager
from player import Player
from queue_manager import QueueManager
from signal_path import SignalPathManager

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger("lucid.main")

# ── ALSA device list helper ────────────────────────────────────────────────────

def _alsa_devices() -> list[str]:
    """Return a list of ALSA PCM device names, or an empty list on non-Linux hosts."""
    try:
        import alsaaudio  # type: ignore[import]
        return alsaaudio.pcms()
    except ImportError:
        return []
    except Exception as exc:
        log.warning("Could not enumerate ALSA devices: %s", exc)
        return []

# ── Singletons ─────────────────────────────────────────────────────────────────

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")
_DEFAULT_ALSA_DEVICE = os.environ.get("ALSA_DEVICE", "default")

redis_client = redis_lib.from_url(_REDIS_URL, decode_responses=False)

sp_manager = SignalPathManager()
sp_manager.signal_path.alsa_device = _DEFAULT_ALSA_DEVICE

queue_mgr = QueueManager()
player = Player(sp_manager, queue_mgr, redis_client)
flux_mgr = FluxManager()

# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    log.info("Lucid starting — REDIS_URL=%s, ALSA_DEVICE=%s", _REDIS_URL, _DEFAULT_ALSA_DEVICE)
    flux_mgr.start()
    yield
    log.info("Lucid shutting down")
    player.stop()
    flux_mgr.stop()

# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Lucid — Phonolith Audio Playback", version="1.0.0", lifespan=lifespan)

# ── Request / Response models ──────────────────────────────────────────────────

class PlayRequest(BaseModel):
    path: str
    device: str | None = None
    endpoint_name: str | None = None


class SeekRequest(BaseModel):
    ms: int


class QueueAddRequest(BaseModel):
    path: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/status")
def status() -> dict[str, Any]:
    """Return the full signal-path state plus queue information."""
    sp = sp_manager.to_dict()
    return {
        "signal_path": sp,
        "queue": {
            "length": len(queue_mgr),
            "position": queue_mgr.position,
            "current": queue_mgr.current(),
            "tracks": queue_mgr.tracks,
        },
    }


@app.get("/devices")
def devices() -> dict[str, Any]:
    """List available ALSA PCM output devices and discovered AirPlay endpoints."""
    return {
        "alsa": _alsa_devices() or ["default"],
        "airplay": flux_mgr.list_endpoints(),
    }


@app.post("/play")
def play(req: PlayRequest) -> dict[str, Any]:
    """
    Start playback of the given file path.

    Optionally specify an ALSA ``device`` or an AirPlay ``endpoint_name``.
    When ``endpoint_name`` is provided, the FluxManager routing stub is called
    (full AirPlay support is future work).
    """
    if not req.path:
        raise HTTPException(status_code=422, detail="path is required")

    if req.endpoint_name:
        # AirPlay routing (placeholder)
        flux_mgr.stream_to(req.endpoint_name, req.path)
        sp_manager.update(endpoint_name=req.endpoint_name)
        return {"status": "airplay_not_implemented", "endpoint": req.endpoint_name}

    device = req.device or sp_manager.signal_path.alsa_device or _DEFAULT_ALSA_DEVICE
    sp_manager.update(alsa_device=device, endpoint_name=None)

    # If the path is not already in the queue, enqueue it as the current track.
    if req.path not in queue_mgr.tracks:
        queue_mgr.enqueue(req.path)
        # Position was already updated by enqueue() when queue was empty, or we
        # need to move it to this track.
        idx = queue_mgr.tracks.index(req.path)
        queue_mgr.position = idx

    player.play(req.path, alsa_device=device)
    return {"status": "playing", "path": req.path, "device": device}


@app.post("/pause")
def pause() -> dict[str, str]:
    player.pause()
    return {"status": "paused"}


@app.post("/resume")
def resume() -> dict[str, str]:
    player.resume()
    return {"status": "playing"}


@app.post("/stop")
def stop() -> dict[str, str]:
    player.stop()
    return {"status": "stopped"}


@app.post("/seek")
def seek(req: SeekRequest) -> dict[str, Any]:
    player.seek(req.ms)
    return {"status": "seeking", "ms": req.ms}


@app.post("/queue/add")
def queue_add(req: QueueAddRequest) -> dict[str, Any]:
    if not req.path:
        raise HTTPException(status_code=422, detail="path is required")
    queue_mgr.enqueue(req.path)
    return {"status": "added", "path": req.path, "queue_length": len(queue_mgr)}


@app.post("/queue/clear")
def queue_clear() -> dict[str, str]:
    queue_mgr.clear()
    return {"status": "cleared"}


@app.post("/queue/next")
def queue_next() -> dict[str, Any]:
    next_path = queue_mgr.next()
    if next_path is None:
        raise HTTPException(status_code=404, detail="No next track in queue")
    device = sp_manager.signal_path.alsa_device or _DEFAULT_ALSA_DEVICE
    player.play(next_path, alsa_device=device)
    return {"status": "playing", "path": next_path}


@app.post("/queue/prev")
def queue_prev() -> dict[str, Any]:
    prev_path = queue_mgr.prev()
    if prev_path is None:
        raise HTTPException(status_code=404, detail="No previous track in queue")
    device = sp_manager.signal_path.alsa_device or _DEFAULT_ALSA_DEVICE
    player.play(prev_path, alsa_device=device)
    return {"status": "playing", "path": prev_path}


@app.get("/airplay/endpoints")
def airplay_endpoints() -> list[dict[str, Any]]:
    """Return discovered AirPlay (RAOP) endpoints."""
    return flux_mgr.list_endpoints()


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
