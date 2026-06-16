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

import asyncio
import json
import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from typing import Any

import httpx
import redis as redis_lib
import redis.asyncio as redis_async
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from flux import FluxManager
from player import Player
from queue_manager import QueueManager
from signal_path import SignalPathManager

import os as _os
try:
    _os.nice(-5)  # Lucid requests elevated scheduling priority for real-time audio
except (AttributeError, PermissionError):
    pass  # Non-root or non-Linux — run at default priority

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
_APP_URL = os.environ.get("APP_URL", "http://app:3000")

redis_client = redis_lib.from_url(_REDIS_URL, decode_responses=False)
redis_async_client = redis_async.from_url(_REDIS_URL, decode_responses=True)

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
    await redis_async_client.close()

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


# ── Browser streaming (RAAT-style: server resolves, endpoint owns nothing) ──────
#
# The browser is just another endpoint. We never proxy these bytes through the
# Next.js app — NGINX routes /stream/* straight here. FileResponse handles
# HTTP Range requests natively, so seeking and MSE pre-fetch both work without
# any custom byte-range code.

async def _resolve_file_path(track_hash: str) -> str:
    """Resolve a BLAKE3 hash to an on-disk path via the app's library API."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{_APP_URL}/api/library/{track_hash}")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Library lookup failed: {exc}") from exc

    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Unknown track hash")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Library lookup failed")

    data = r.json()
    path = data.get("file_path")
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Source file not accessible to Lucid")
    return path


@app.get("/stream/{track_hash}")
async def stream(track_hash: str) -> FileResponse:
    """
    Stream the original file bytes for a library track, unmodified.

    Passthrough only — no transcoding. Lossless and hi-res formats are
    served exactly as stored; the browser endpoint decodes them locally.
    """
    path = await _resolve_file_path(track_hash)
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=os.path.basename(path))


# ── Realtime transport state (replaces HTTP polling) ─────────────────────────────

@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    """
    Push signal-path/transport state to the browser the moment it changes,
    by forwarding Lucid's existing Redis pub-sub channel. Sends the current
    state immediately on connect so the UI never has to wait for the next
    change to render.
    """
    await websocket.accept()
    pubsub = redis_async_client.pubsub()
    await pubsub.subscribe(sp_manager.REDIS_CHANNEL)

    try:
        await websocket.send_text(json.dumps(sp_manager.to_dict()))

        listen_task = asyncio.create_task(_forward_pubsub(pubsub, websocket))
        recv_task = asyncio.create_task(websocket.receive_text())
        done, pending = await asyncio.wait(
            {listen_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(sp_manager.REDIS_CHANNEL)
        await pubsub.close()


async def _forward_pubsub(pubsub: Any, websocket: WebSocket) -> None:
    async for message in pubsub.listen():
        if message.get("type") != "message":
            continue
        await websocket.send_text(message["data"])


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
