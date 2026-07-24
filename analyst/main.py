import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

from scanner import scan_library, scan_source_config, get_file_record, APP_URL, INTERNAL_SERVICE_TOKEN
from watcher import start_watcher, stop_watcher

log = logging.getLogger("analyst")

LIBRARY_PATH = os.environ.get("LIBRARY_PATH", "/music")
WAVEFORM_PATH = os.environ.get("WAVEFORM_PATH", "/waveforms")

STATUS = {
    "files_indexed": 0,
    "last_scan": None,
    "watching": False,
    "scanning": False,
    "scan_progress": {
        "phase": "idle",
        "total": 0,
        "done": 0,
        "current_file": None,
        "errors": [],
        "source_name": None,
    },
}


def make_progress_cb(source_name: str = ""):
    def cb(total: int, done: int, current: str | None, error: str | None = None):
        p = STATUS["scan_progress"]
        if total == -1:
            p["phase"] = "discovering"
            p["done"] = done
            p["total"] = 0
        else:
            p["phase"] = "indexing"
            p["total"] = total
            p["done"] = done
        p["current_file"] = current
        p["source_name"] = source_name
        if error:
            p["errors"].append(error)
    return cb


_main_loop: asyncio.AbstractEventLoop | None = None

# Background scan tasks are fire-and-forget from the caller's perspective
# (the HTTP handler returns immediately), but asyncio silently drops any
# exception raised in a task whose result/exception is never retrieved, and
# can even garbage-collect a task early if nothing keeps a reference to it.
# Keep a reference and log failures instead of losing them.
_background_tasks: set[asyncio.Task] = set()


def _track(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _background_tasks.discard(t)
        if not t.cancelled() and t.exception() is not None:
            log.error("Background task failed", exc_info=t.exception())

    task.add_done_callback(_on_done)
    return task


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    os.makedirs(WAVEFORM_PATH, exist_ok=True)
    if os.path.isdir(LIBRARY_PATH):
        start_watcher(LIBRARY_PATH, on_file_changed=schedule_scan)
        STATUS["watching"] = True
    yield
    stop_watcher()


def schedule_scan():
    # Called from the watchdog observer's debounce Timer thread, not the
    # asyncio event loop thread — asyncio.create_task() requires a running
    # loop in the *current* thread and would silently fail here (the
    # exception is swallowed by threading.Timer, only printed to stderr),
    # so live filesystem changes would never actually trigger a rescan.
    # run_coroutine_threadsafe schedules onto the loop from any thread.
    if _main_loop is not None:
        asyncio.run_coroutine_threadsafe(run_scan(LIBRARY_PATH, ""), _main_loop)


async def run_scan(path: str, source_name: str, deep_analysis: bool = True):
    from datetime import datetime, timezone
    STATUS["scanning"] = True
    STATUS["scan_progress"]["errors"] = []
    STATUS["scan_progress"]["phase"] = "indexing"
    cb = make_progress_cb(source_name)
    try:
        # Fast pass — everything visible in seconds.
        indexed = await asyncio.to_thread(scan_library, path, WAVEFORM_PATH, cb)
        STATUS["files_indexed"] = indexed
        STATUS["last_scan"] = datetime.now(timezone.utc).isoformat()
        # Deep pass — fill in DR/spectral/waveform/fingerprint in the background.
        if deep_analysis:
            await _run_pending_deep_scans(manage_status=False)
    finally:
        STATUS["scanning"] = False
        STATUS["scan_progress"]["phase"] = "idle"


app = FastAPI(title="Phonolith Analyst", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def status():
    return STATUS


class ScanRequest(BaseModel):
    path: str = "/music"
    deep_analysis: bool = True


@app.post("/scan")
async def scan(req: ScanRequest):
    _track(run_scan(req.path, "", req.deep_analysis))
    return {"message": "Scan started"}


class PingRequest(BaseModel):
    host: str
    port: int = 445


@app.post("/ping")
async def ping(req: PingRequest):
    import socket
    import time
    start = time.monotonic()
    try:
        with socket.create_connection((req.host, req.port), timeout=5):
            latency_ms = round((time.monotonic() - start) * 1000)
            return {"reachable": True, "latency_ms": latency_ms, "port": req.port}
    except OSError as e:
        return {"reachable": False, "error": str(e), "port": req.port}


class SourceConfig(BaseModel):
    type: str
    config: dict
    name: str = ""


@app.post("/test-source")
async def test_source(req: SourceConfig):
    try:
        result = await asyncio.to_thread(_test_source_sync, req.type, req.config)
        return result
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _test_source_sync(src_type: str, config: dict) -> dict:
    from pathlib import Path
    from scanner import AUDIO_EXTENSIONS

    if src_type in ("local", "nfs", "iscsi"):
        path = config.get("path", "")
        if not path or not os.path.isdir(path):
            return {"ok": False, "error": f"Path not found: {path}"}
        count = sum(
            1 for root, _, files in os.walk(path)
            for f in files if Path(f).suffix.lower() in AUDIO_EXTENSIONS
        )
        return {"ok": True, "files_found": count}

    elif src_type == "smb":
        import socket
        import smbclient
        host = config.get("host", "")
        share = config.get("share", "")
        username = config.get("username", "")
        password = config.get("password", "")
        domain = config.get("domain", "")
        if not host or not share:
            return {"ok": False, "error": "Host and share name are required"}
        # Step 1: TCP reachability
        try:
            with socket.create_connection((host, 445), timeout=5):
                pass
        except OSError:
            return {"ok": False, "error": f"Cannot reach {host}:445 — is the host online and SMB enabled?"}
        # Step 2: SMB auth + listing
        try:
            effective_user = username or None
            if effective_user and domain:
                effective_user = f"{domain}\\{effective_user}"
            smbclient.register_session(host, username=effective_user, password=password or None)
            smb_path = rf"\\{host}\{share}"
            entries = list(smbclient.scandir(smb_path))
            return {"ok": True, "files_found": len(entries)}
        except Exception as e:
            log.exception("SMB test failed for %s\\%s", host, share)
            return {"ok": False, "error": f"Auth/share error: {e}"}

    return {"ok": False, "error": f"Unknown source type: {src_type}"}


class ScanSourceRequest(BaseModel):
    source_id: int | None = None
    type: str
    config: dict
    name: str = ""
    deep_analysis: bool = True


@app.post("/scan-source")
async def scan_source(req: ScanSourceRequest):
    if STATUS["scanning"]:
        return {"message": "Scan already in progress", "ok": False}
    _track(_run_source_scan(req))
    return {"message": "Scan started", "ok": True}


async def _run_source_scan(req: ScanSourceRequest):
    from datetime import datetime, timezone
    STATUS["scanning"] = True
    STATUS["scan_progress"]["errors"] = []
    STATUS["scan_progress"]["phase"] = "discovering" if req.type == "smb" else "indexing"
    cb = make_progress_cb(req.name)
    try:
        # Fast pass — everything visible in seconds.
        indexed = await asyncio.to_thread(scan_source_config, req.type, req.config, WAVEFORM_PATH, cb, req.source_id)
        STATUS["files_indexed"] = STATUS.get("files_indexed", 0) + indexed
        STATUS["last_scan"] = datetime.now(timezone.utc).isoformat()
        # Deep pass — fill in DR/spectral/waveform/fingerprint in the background.
        if req.deep_analysis:
            await _run_pending_deep_scans(manage_status=False)
    finally:
        STATUS["scanning"] = False
        STATUS["scan_progress"]["phase"] = "idle"


@app.get("/file/{hash}")
def get_file(hash: str):
    record = get_file_record(hash)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    return record


class FingerprintRequest(BaseModel):
    path: str


@app.post("/fingerprint")
async def fingerprint_file(req: FingerprintRequest):
    from fingerprint import get_fingerprint
    fp = await asyncio.to_thread(get_fingerprint, req.path)
    if not fp:
        raise HTTPException(status_code=502, detail="Fingerprinting failed")
    return {"fingerprint": fp}


class AccurateRipRequest(BaseModel):
    path: str
    duration_ms: int | None = None

@app.post("/accuraterip")
async def accuraterip(req: AccurateRipRequest):
    from accuraterip import verify_track
    result = await asyncio.to_thread(verify_track, req.path, req.duration_ms)
    return result


class DeepScanRequest(BaseModel):
    path: str
    source_type: str = "local"
    config: dict = {}
    source_id: int | None = None


@app.post("/deep-scan")
async def deep_scan(req: DeepScanRequest):
    """Full analysis pass on a single already-indexed file (DR, spectral, waveform, AcoustID).

    For `source_type == "smb"`, `path` is the file's stored display path
    (e.g. "//host/share/sub/track.flac") and `config` carries the SMB
    connection info (host/share/subfolder/credentials) — the full file is
    downloaded to a temp file before analysis, since waveform rendering
    needs the complete decoded audio stream, not just a header.
    """
    if req.source_type == "smb":
        if not req.config.get("host") or not req.config.get("share"):
            return {"ok": False, "error": "Missing SMB connection config"}
        _track(_run_deep_scan_smb(req.path, req.config, req.source_id))
        return {"ok": True, "message": "Deep scan started"}

    if not os.path.isfile(req.path):
        return {"ok": False, "error": f"File not found: {req.path}"}
    _track(_run_deep_scan(req.path))
    return {"ok": True, "message": "Deep scan started"}


async def _run_deep_scan(path: str):
    from scanner import index_file
    try:
        record = await asyncio.to_thread(index_file, path, WAVEFORM_PATH)
        if record:
            log.info("Deep scan complete: %s", path)
        else:
            log.warning("Deep scan returned no record: %s", path)
    except Exception:
        log.exception("Deep scan failed: %s", path)


async def _run_deep_scan_smb(display_path: str, config: dict, source_id: int | None):
    from scanner import deep_scan_smb_file
    try:
        record = await asyncio.to_thread(deep_scan_smb_file, display_path, config, WAVEFORM_PATH, source_id)
        if record:
            log.info("SMB deep scan complete: %s", display_path)
        else:
            log.warning("SMB deep scan returned no record: %s", display_path)
    except Exception:
        log.exception("SMB deep scan failed: %s", display_path)


@app.post("/deep-scan-pending")
async def deep_scan_pending():
    """Deep-analyse all files that were fast-indexed (dr_score IS NULL)."""
    if STATUS["scanning"]:
        return {"ok": False, "message": "Scan already in progress"}
    _track(_run_pending_deep_scans())
    return {"ok": True, "message": "Pending deep scan started"}


async def _run_pending_deep_scans(manage_status: bool = True):
    """Run the deep analysis pass over every fast-indexed file (dr_score IS NULL).

    `manage_status` toggles ownership of the STATUS["scanning"] flag: True when
    invoked standalone (the /deep-scan-pending endpoint), False when chained
    directly after a fast scan pass whose caller already holds the flag — so the
    UI shows one continuous scan rather than flickering idle in between.
    """
    import httpx
    from scanner import index_file
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{APP_URL}/api/library/pending-analysis",
                headers={"X-Internal-Token": INTERNAL_SERVICE_TOKEN},
            )
            if not r.is_success:
                return
            files = r.json()

        log.info("Deep scan pending: %d files queued", len(files))
        if manage_status:
            STATUS["scanning"] = True
        STATUS["scan_progress"]["phase"] = "indexing"
        STATUS["scan_progress"]["total"] = len(files)
        STATUS["scan_progress"]["done"] = 0
        STATUS["scan_progress"]["source_name"] = "Deep analysis pass"
        STATUS["scan_progress"]["errors"] = []

        for i, f in enumerate(files):
            path = f.get("file_path", "")
            STATUS["scan_progress"]["current_file"] = path
            if not path or not os.path.isfile(path):
                STATUS["scan_progress"]["done"] = i + 1
                continue
            try:
                await asyncio.to_thread(index_file, path, WAVEFORM_PATH)
            except Exception as e:
                STATUS["scan_progress"]["errors"].append(str(e))
            STATUS["scan_progress"]["done"] = i + 1
    finally:
        if manage_status:
            STATUS["scanning"] = False
            STATUS["scan_progress"]["phase"] = "idle"
        STATUS["scan_progress"]["current_file"] = None


class WriteTagsRequest(BaseModel):
    path: str
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    year: str | None = None
    track_number: int | None = None
    disc_number: int | None = None
    engineer: str | None = None


@app.post("/write-tags/{hash}")
async def write_tags_endpoint(hash: str, req: WriteTagsRequest):
    """Rewrite embedded tags on disk for an opted-in metadata override.

    Only ever called for local files — writing requires direct filesystem
    access, so the path must resolve under LIBRARY_PATH. This guards against
    a misconfigured caller pointing this at an SMB/NFS mount path string that
    happens to look local.
    """
    real_library = os.path.realpath(LIBRARY_PATH)
    real_path = os.path.realpath(req.path)
    if os.path.commonpath([real_library, real_path]) != real_library:
        raise HTTPException(status_code=400, detail="Path is not under the local library root")

    if not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="File not found")

    fields = req.model_dump(exclude={"path"}, exclude_none=True)
    try:
        from scanner import write_tags
        await asyncio.to_thread(write_tags, real_path, fields)
    except Exception as e:
        log.exception("Tag write-back failed: %s", real_path)
        raise HTTPException(status_code=500, detail=f"Tag write-back failed: {e}")

    return {"ok": True}


@app.get("/waveforms/{hash}")
def get_waveform(hash: str):
    # Try sharded path first, then fall back to legacy flat path
    sharded = os.path.join(WAVEFORM_PATH, hash[0:2], hash[2:4], f"{hash}.png")
    legacy = os.path.join(WAVEFORM_PATH, f"{hash}.png")
    path = sharded if os.path.exists(sharded) else (legacy if os.path.exists(legacy) else None)
    if not path:
        raise HTTPException(status_code=404, detail="Waveform not found")
    return FileResponse(path, media_type="image/png")


@app.get("/waveforms/{hash}/cover")
def get_cover_art(hash: str):
    sharded = os.path.join(WAVEFORM_PATH, hash[0:2], hash[2:4], f"{hash}_cover.jpg")
    if not os.path.exists(sharded):
        raise HTTPException(status_code=404, detail="Cover art not found")
    return FileResponse(sharded, media_type="image/jpeg")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
