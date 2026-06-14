import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

from scanner import scan_library, get_file_record, FILE_DB
from watcher import start_watcher, stop_watcher

LIBRARY_PATH = os.environ.get("LIBRARY_PATH", "/music")
WAVEFORM_PATH = os.environ.get("WAVEFORM_PATH", "/waveforms")
STATUS = {"files_indexed": 0, "last_scan": None, "watching": False}


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(WAVEFORM_PATH, exist_ok=True)
    start_watcher(LIBRARY_PATH, on_file_changed=schedule_scan)
    STATUS["watching"] = True
    yield
    stop_watcher()


def schedule_scan():
    asyncio.create_task(run_scan(LIBRARY_PATH))


async def run_scan(path: str):
    from datetime import datetime, timezone
    indexed = await asyncio.to_thread(scan_library, path, WAVEFORM_PATH)
    STATUS["files_indexed"] = indexed
    STATUS["last_scan"] = datetime.now(timezone.utc).isoformat()


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
    asyncio.create_task(run_scan(req.path))
    return {"message": "Scan started"}


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
