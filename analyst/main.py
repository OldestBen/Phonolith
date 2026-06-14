import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

log = logging.getLogger("analyst")

from scanner import scan_library, scan_source_config, get_file_record, FILE_DB
from watcher import start_watcher, stop_watcher

LIBRARY_PATH = os.environ.get("LIBRARY_PATH", "/music")
WAVEFORM_PATH = os.environ.get("WAVEFORM_PATH", "/waveforms")

STATUS = {
    "files_indexed": 0,
    "last_scan": None,
    "watching": False,
    "scanning": False,
    "scan_progress": {
        "total": 0,
        "done": 0,
        "current_file": None,
        "errors": [],
        "source_name": None,
    },
}


def make_progress_cb(source_name: str = ""):
    def cb(total: int, done: int, current: str | None, error: str | None = None):
        STATUS["scan_progress"]["total"] = total
        STATUS["scan_progress"]["done"] = done
        STATUS["scan_progress"]["current_file"] = current
        STATUS["scan_progress"]["source_name"] = source_name
        if error:
            STATUS["scan_progress"]["errors"].append(error)
    return cb


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(WAVEFORM_PATH, exist_ok=True)
    if os.path.isdir(LIBRARY_PATH):
        start_watcher(LIBRARY_PATH, on_file_changed=schedule_scan)
        STATUS["watching"] = True
    yield
    stop_watcher()


def schedule_scan():
    asyncio.create_task(run_scan(LIBRARY_PATH, ""))


async def run_scan(path: str, source_name: str):
    from datetime import datetime, timezone
    STATUS["scanning"] = True
    STATUS["scan_progress"]["errors"] = []
    cb = make_progress_cb(source_name)
    try:
        indexed = await asyncio.to_thread(scan_library, path, WAVEFORM_PATH, cb)
        STATUS["files_indexed"] = indexed
        STATUS["last_scan"] = datetime.now(timezone.utc).isoformat()
    finally:
        STATUS["scanning"] = False


app = FastAPI(title="Phonolith Analyst", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def status():
    return STATUS


class ScanRequest(BaseModel):
    path: str = "/music"


@app.post("/scan")
async def scan(req: ScanRequest):
    asyncio.create_task(run_scan(req.path, ""))
    return {"message": "Scan started"}


class PingRequest(BaseModel):
    host: str
    port: int = 445


@app.post("/ping")
async def ping(req: PingRequest):
    import socket, time
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
        import socket, smbclient
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


@app.post("/scan-source")
async def scan_source(req: ScanSourceRequest):
    if STATUS["scanning"]:
        return {"message": "Scan already in progress", "ok": False}
    asyncio.create_task(_run_source_scan(req))
    return {"message": "Scan started", "ok": True}


async def _run_source_scan(req: ScanSourceRequest):
    from datetime import datetime, timezone
    STATUS["scanning"] = True
    STATUS["scan_progress"]["errors"] = []
    cb = make_progress_cb(req.name)
    try:
        indexed = await asyncio.to_thread(scan_source_config, req.type, req.config, WAVEFORM_PATH, cb)
        STATUS["files_indexed"] = STATUS.get("files_indexed", 0) + indexed
        STATUS["last_scan"] = datetime.now(timezone.utc).isoformat()
    finally:
        STATUS["scanning"] = False


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


@app.get("/waveforms/{hash}")
def get_waveform(hash: str):
    path = os.path.join(WAVEFORM_PATH, f"{hash}.png")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Waveform not found")
    return FileResponse(path, media_type="image/png")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
