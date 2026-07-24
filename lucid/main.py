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
import io
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
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from flux import FluxManager
from polyphony_discovery import PolyphonyDiscovery
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
# Shared token for calls into the app's internal API (mirrors the fallback in
# src/lib/auth.ts's getInternalServiceToken()), since Lucid has no browser session.
_INTERNAL_SERVICE_TOKEN = (
    os.environ.get("INTERNAL_SERVICE_TOKEN") or "phonolith-dev-internal-token-not-for-production"
)

redis_client = redis_lib.from_url(_REDIS_URL, decode_responses=False)
redis_async_client = redis_async.from_url(_REDIS_URL, decode_responses=True)

sp_manager = SignalPathManager()
sp_manager.signal_path.alsa_device = _DEFAULT_ALSA_DEVICE

queue_mgr = QueueManager()
player = Player(sp_manager, queue_mgr, redis_client)
flux_mgr = FluxManager()
polyphony_mgr = PolyphonyDiscovery()

# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    log.info("Lucid starting — REDIS_URL=%s, ALSA_DEVICE=%s", _REDIS_URL, _DEFAULT_ALSA_DEVICE)
    flux_mgr.start()
    polyphony_mgr.start()
    yield
    log.info("Lucid shutting down")
    player.stop()
    await flux_mgr.stop_streaming()
    flux_mgr.stop()
    polyphony_mgr.stop()
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
async def play(req: PlayRequest) -> dict[str, Any]:
    """
    Start playback of the given file path.

    Optionally specify an ALSA ``device`` or an AirPlay ``endpoint_name``.
    When ``endpoint_name`` is provided, playback is routed over RTSP/ALAC to
    the named AirPlay receiver via FluxManager instead of ALSA.
    """
    if not req.path:
        raise HTTPException(status_code=422, detail="path is required")

    if req.endpoint_name:
        # player.stop() can block on Thread.join(timeout=5) — run off the
        # event loop so a slow-to-stop playback thread can't freeze the
        # websocket pubsub forwarding and health checks for up to 5s.
        await asyncio.to_thread(player.stop)
        try:
            await flux_mgr.stream_to(req.endpoint_name, req.path)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        sp_manager.update(endpoint_name=req.endpoint_name, alsa_device=None)
        return {"status": "playing", "path": req.path, "endpoint": req.endpoint_name}

    await flux_mgr.stop_streaming()
    device = req.device or sp_manager.signal_path.alsa_device or _DEFAULT_ALSA_DEVICE
    sp_manager.update(alsa_device=device, endpoint_name=None)

    # If the path is not already in the queue, enqueue it as the current track.
    if req.path not in queue_mgr.tracks:
        queue_mgr.enqueue(req.path)
        # Position was already updated by enqueue() when queue was empty, or we
        # need to move it to this track.
        idx = queue_mgr.tracks.index(req.path)
        queue_mgr.position = idx

    await asyncio.to_thread(player.play, req.path, alsa_device=device)
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
async def stop() -> dict[str, str]:
    await asyncio.to_thread(player.stop)
    await flux_mgr.stop_streaming()
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


# ── Polyphony LAN discovery ──────────────────────────────────────────────────

class PolyphonyAnnounceRequest(BaseModel):
    enabled: bool
    peer_id: str
    name: str
    port: int = 80


@app.post("/polyphony/announce")
def polyphony_announce(req: PolyphonyAnnounceRequest) -> dict[str, str]:
    """Start or stop broadcasting this instance's existence on the LAN via mDNS."""
    if req.enabled:
        polyphony_mgr.announce(req.peer_id, req.name, req.port)
        return {"status": "announcing"}
    polyphony_mgr.unannounce()
    return {"status": "stopped"}


@app.get("/polyphony/discovered")
def polyphony_discovered() -> list[dict[str, Any]]:
    """List other Polyphony instances discovered on the LAN."""
    return polyphony_mgr.list_discovered()


# ── Browser streaming (RAAT-style: server resolves, endpoint owns nothing) ──────
#
# The browser is just another endpoint. We never proxy these bytes through the
# Next.js app — Caddy routes /stream/* straight here. FileResponse handles
# HTTP Range requests natively, so seeking and MSE pre-fetch both work without
# any custom byte-range code.

async def _resolve_track(track_hash: str) -> dict:
    """Resolve a BLAKE3 hash to its library row (path, source_id, …) via the app API."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"{_APP_URL}/api/library/{track_hash}",
                headers={"X-Internal-Token": _INTERNAL_SERVICE_TOKEN},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Library lookup failed: {exc}") from exc

    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Unknown track hash")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Library lookup failed")
    return r.json()


async def _fetch_source_config(source_id: Any) -> dict:
    """Fetch a source's decrypted connection config (SMB host/share/credentials)."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"{_APP_URL}/api/library/sources/{source_id}/config",
                headers={"X-Internal-Token": _INTERNAL_SERVICE_TOKEN},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Source lookup failed: {exc}") from exc
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Source config unavailable")
    return r.json().get("config") or {}


def _is_network_path(path: str) -> bool:
    """True for SMB/UNC paths (`//host/share/...` or `\\\\host\\share\\...`)."""
    return path.startswith("//") or path.startswith("\\\\")


def _register_smb(config: dict) -> None:
    """Register an smbclient session for the given source config (blocking)."""
    import smbclient

    host = config.get("host", "")
    username = config.get("username") or None
    password = config.get("password") or None
    domain = config.get("domain") or None
    effective_user = username
    if effective_user and domain:
        effective_user = f"{domain}\\{effective_user}"
    smbclient.register_session(host, username=effective_user, password=password)


def _smb_size(smb_path: str, config: dict) -> int:
    """Open the SMB file and return its total size in bytes (blocking)."""
    import smbclient

    _register_smb(config)
    with smbclient.open_file(smb_path, mode="rb") as f:
        return f.seek(0, io.SEEK_END)


def _smb_read_range(smb_path: str, config: dict, start: int, end: int, chunk_size: int = 262144):
    """Yield bytes [start, end] (inclusive) from an SMB file — a blocking generator.

    Run by StreamingResponse in a threadpool, so its blocking smbclient reads
    never stall the event loop.
    """
    import smbclient

    _register_smb(config)
    with smbclient.open_file(smb_path, mode="rb") as f:
        if start:
            f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


async def _stream_smb(smb_path: str, config: dict, request: Request, media_type: str, filename: str):
    """Passthrough-stream an SMB file with HTTP Range support (seeking works)."""
    try:
        size = await asyncio.to_thread(_smb_size, smb_path, config)
    except Exception as exc:  # noqa: BLE001 — surface any SMB/auth failure as 404
        log.warning("SMB open failed for %s: %s", smb_path, exc)
        raise HTTPException(status_code=404, detail="Source file not accessible to Lucid") from exc

    start, end = 0, size - 1
    status = 200
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{filename}"',
    }

    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes="):
        spec = range_header[len("bytes="):].split(",")[0].strip()
        s, _, e = spec.partition("-")
        try:
            start = int(s) if s else 0
            end = int(e) if e else size - 1
        except ValueError:
            start, end = 0, size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            raise HTTPException(
                status_code=416,
                detail="Requested range not satisfiable",
                headers={"Content-Range": f"bytes */{size}"},
            )
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"

    headers["Content-Length"] = str(end - start + 1)
    return StreamingResponse(
        _smb_read_range(smb_path, config, start, end),
        status_code=status,
        media_type=media_type,
        headers=headers,
    )


# Network-adaptive streaming: opt-in lossy transcode for constrained links
# (e.g. cellular). Bitrate is whitelisted, never taken verbatim from the
# client, to keep the ffmpeg command line fixed-shape.
_OPUS_BITRATES = {"32", "64", "96", "128"}
_DEFAULT_OPUS_BITRATE = "96"


async def _transcode_opus(path: str, bitrate: str):
    """Yield Ogg/Opus bytes from ffmpeg transcoding `path` on the fly."""
    proc = await asyncio.create_subprocess_exec(
        # -threads 1: a single thread is plenty for real-time Opus encoding
        # at these bitrates, and keeps a remote-streaming transcode from
        # competing with a concurrent bit-perfect ALSA playback on the same
        # host (libopus is multi-threaded by default and would otherwise
        # try to claim every core).
        "ffmpeg", "-nostdin", "-v", "error", "-threads", "1",
        "-i", path,
        "-map", "0:a:0",
        "-c:a", "libopus", "-b:a", f"{bitrate}k", "-vbr", "on",
        "-f", "ogg", "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(64 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        if proc.returncode is None:
            proc.kill()
        stderr = await proc.stderr.read() if proc.stderr else b""
        await proc.wait()
        if proc.returncode not in (0, None, -9):
            log.warning("ffmpeg transcode exited %s for %s: %s", proc.returncode, path, stderr.decode(errors="replace"))


async def _transcode_opus_smb(smb_path: str, config: dict, bitrate: str):
    """Yield Ogg/Opus bytes from ffmpeg transcoding an SMB file fed over stdin.

    ffmpeg can't read a UNC path directly, so the SMB bytes are pumped into its
    stdin (`pipe:0`). The read side runs in threads (blocking smbclient) while
    the write/drain stays on the event loop.
    """
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-nostdin", "-v", "error", "-threads", "1",
        "-i", "pipe:0",
        "-map", "0:a:0",
        "-c:a", "libopus", "-b:a", f"{bitrate}k", "-vbr", "on",
        "-f", "ogg", "-",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stdout is not None

    async def _feed() -> None:
        import smbclient

        def _open():
            _register_smb(config)
            return smbclient.open_file(smb_path, mode="rb")

        try:
            f = await asyncio.to_thread(_open)
            try:
                while True:
                    chunk = await asyncio.to_thread(f.read, 262144)
                    if not chunk:
                        break
                    proc.stdin.write(chunk)
                    await proc.stdin.drain()
            finally:
                await asyncio.to_thread(f.close)
        except Exception as exc:  # noqa: BLE001
            log.warning("SMB opus feed failed for %s: %s", smb_path, exc)
        finally:
            try:
                proc.stdin.close()
            except Exception:  # noqa: BLE001
                pass

    feeder = asyncio.create_task(_feed())
    try:
        while True:
            chunk = await proc.stdout.read(64 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        feeder.cancel()
        if proc.returncode is None:
            proc.kill()
        stderr = await proc.stderr.read() if proc.stderr else b""
        await proc.wait()
        if proc.returncode not in (0, None, -9):
            log.warning("ffmpeg transcode exited %s for %s: %s", proc.returncode, smb_path, stderr.decode(errors="replace"))


def _opus_bitrate(request: Request) -> str:
    bitrate = request.query_params.get("bitrate", _DEFAULT_OPUS_BITRATE)
    return bitrate if bitrate in _OPUS_BITRATES else _DEFAULT_OPUS_BITRATE


@app.get("/stream/{track_hash}")
async def stream(track_hash: str, request: Request):
    """
    Stream a library track.

    Passthrough by default — no transcoding. Lossless and hi-res formats are
    served exactly as stored; the browser endpoint decodes them locally and
    HTTP Range requests work natively for seeking.

    Local-source files are served straight off Lucid's /music mount. SMB-source
    files (stored with a `//host/share/...` path) can't be opened as local
    files — Lucid only mounts /music — so they're streamed directly over SMB
    using the source's stored credentials, with the same Range support.

    Pass `?format=opus[&bitrate=32|64|96|128]` to request an on-the-fly
    lossy transcode instead, for network-adaptive (e.g. cellular) playback.
    Transcoded streams are not seekable via Range — the endpoint should
    restart the request at a new position if it needs to seek.
    """
    data = await _resolve_track(track_hash)
    path = data.get("file_path")
    if not path:
        raise HTTPException(status_code=404, detail="Track has no file path")

    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    filename = os.path.basename(path)
    fmt = request.query_params.get("format")

    # ── SMB / network source ────────────────────────────────────────────────
    if _is_network_path(path) and not os.path.isfile(path):
        source_id = data.get("source_id")
        if source_id is None:
            raise HTTPException(status_code=404, detail="Network track has no source id")
        config = await _fetch_source_config(source_id)
        smb_path = path.replace("/", "\\")  # UNC form for smbclient
        if fmt == "opus":
            return StreamingResponse(
                _transcode_opus_smb(smb_path, config, _opus_bitrate(request)),
                media_type="audio/ogg",
            )
        return await _stream_smb(smb_path, config, request, media_type, filename)

    # ── Local source ────────────────────────────────────────────────────────
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Source file not accessible to Lucid")

    if fmt == "opus":
        return StreamingResponse(_transcode_opus(path, _opus_bitrate(request)), media_type="audio/ogg")

    return FileResponse(path, media_type=media_type, filename=filename)


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
