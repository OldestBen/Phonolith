import hashlib
import io
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable
import httpx

APP_URL = os.environ.get("APP_URL", "http://app:3000")

AUDIO_EXTENSIONS = {'.flac', '.mp3', '.aac', '.m4a', '.ogg', '.wav', '.aiff', '.wv', '.ape', '.opus'}

FILE_DB: dict[str, dict] = {}

ProgressCb = Callable[[int, int, str | None, str | None], None] | None


def _hash_file(path: str) -> str:
    try:
        import blake3 as _b3
        h = _b3.blake3()
    except ImportError:
        h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def _hash_fileobj(fileobj) -> str:
    try:
        import blake3 as _b3
        h = _b3.blake3()
    except ImportError:
        h = hashlib.sha256()
    while chunk := fileobj.read(65536):
        h.update(chunk)
    return h.hexdigest()


def _read_tags(fileobj_or_path) -> dict:
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(fileobj_or_path, easy=True)
        if not audio:
            return {}
        info = audio.info
        return {
            "title": str(audio.get("title", [""])[0]) if audio.get("title") else None,
            "artist": str(audio.get("artist", [""])[0]) if audio.get("artist") else None,
            "album": str(audio.get("album", [""])[0]) if audio.get("album") else None,
            "year": str(audio.get("date", [""])[0])[:4] if audio.get("date") else None,
            "track": str(audio.get("tracknumber", [""])[0]) if audio.get("tracknumber") else None,
            "bitrate": getattr(info, "bitrate", None),
            "sample_rate": getattr(info, "sample_rate", None),
            "length": getattr(info, "length", None),
        }
    except Exception:
        return {}


def _detect_bit_depth(path: str) -> int | None:
    try:
        from mutagen.flac import FLAC
        if path.lower().endswith(".flac"):
            return FLAC(path).info.bits_per_sample
    except Exception:
        pass
    return None


def _compute_dr(path: str) -> float | None:
    try:
        import numpy as np
        import librosa
        y, _ = librosa.load(path, sr=None, mono=True, duration=60)
        if len(y) == 0:
            return None
        rms = float(np.sqrt(np.mean(y ** 2)))
        peak = float(np.max(np.abs(y)))
        if rms < 1e-10:
            return None
        return round(20 * np.log10(peak / rms), 2)
    except Exception:
        return None


def _detect_upscale(path: str) -> bool | None:
    try:
        import numpy as np
        import librosa
        y, sr = librosa.load(path, sr=None, mono=True, duration=30)
        if len(y) == 0:
            return None
        fft = np.abs(np.fft.rfft(y))
        freqs = np.fft.rfftfreq(len(y), 1 / sr)
        mask_hi = freqs > 18000
        mask_lo = (freqs > 1000) & (freqs < 18000)
        if mask_hi.sum() == 0 or mask_lo.sum() == 0:
            return None
        ratio = float(np.mean(fft[mask_hi] ** 2)) / (float(np.mean(fft[mask_lo] ** 2)) + 1e-12)
        return ratio > 1e-6
    except Exception:
        return None


def _render_waveform(path: str, file_hash: str, waveform_path: str) -> str | None:
    output = os.path.join(waveform_path, f"{file_hash}.png")
    if os.path.exists(output):
        return output
    try:
        import numpy as np
        import librosa
        from PIL import Image, ImageDraw
        y, _ = librosa.load(path, sr=None, mono=True, duration=120)
        W, H = 1200, 200
        img = Image.new("RGB", (W, H), "#08080a")
        draw = ImageDraw.Draw(img)
        chunk = max(1, len(y) // W)
        peaks = [float(np.max(np.abs(y[i * chunk:(i + 1) * chunk]))) for i in range(W)]
        max_peak = max(peaks) or 1
        for x, peak in enumerate(peaks):
            h = int((peak / max_peak) * (H // 2 - 2))
            mid = H // 2
            draw.line([(x, mid - h), (x, mid + h)], fill="#a78bfa", width=1)
        img.save(output, "PNG")
        return output
    except Exception:
        return None


def _post_to_app(data: dict) -> None:
    try:
        httpx.post(f"{APP_URL}/api/library/ingest", json=data, timeout=10)
    except Exception:
        pass


def index_file(path: str, waveform_path: str, display_path: str | None = None) -> dict | None:
    """Full analysis: hash + tags + librosa DR + waveform. Used for local sources."""
    try:
        h = _hash_file(path)
        tags = _read_tags(path)
        fmt = Path(display_path or path).suffix.lower().lstrip(".")
        bit_depth = _detect_bit_depth(path)
        dr = _compute_dr(path)
        spectral_ok = _detect_upscale(path)
        waveform = _render_waveform(path, h, waveform_path)
        try:
            import acoustid
            raw_fp = acoustid.fingerprint_file(path)
            fp = raw_fp[1].decode() if isinstance(raw_fp[1], bytes) else raw_fp[1]
        except Exception:
            fp = None

        record = {
            "blake3_hash": h,
            "file_path": display_path or path,
            "format": fmt,
            "bitrate": tags.get("bitrate"),
            "sample_rate": tags.get("sample_rate"),
            "bit_depth": bit_depth,
            "duration_ms": int(tags.get("length", 0) * 1000) if tags.get("length") else None,
            "dr_score": dr,
            "spectral_ok": spectral_ok,
            "waveform_path": waveform,
            "fingerprint": fp,
        }
        FILE_DB[h] = record
        _post_to_app(record)
        return record
    except Exception:
        return None


def _smb_fast_index(smb_path: str, display: str) -> dict | None:
    """
    Fast SMB indexing: streams the file once to compute hash + grab first
    512 KB for mutagen tags. No temp file, no librosa, no waveform.
    """
    import smbclient

    fmt = Path(display).suffix.lower().lstrip(".")

    try:
        import blake3 as _b3
        h = _b3.blake3()
    except ImportError:
        h = hashlib.sha256()

    HEADER_LIMIT = 524288  # 512 KB — enough for any tag block
    header_buf = io.BytesIO()
    header_full = False

    with smbclient.open_file(smb_path, mode="rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
            if not header_full:
                header_buf.write(chunk)
                if header_buf.tell() >= HEADER_LIMIT:
                    header_full = True

    file_hash = h.hexdigest()

    header_buf.seek(0)
    tags = _read_tags(header_buf)

    record = {
        "blake3_hash": file_hash,
        "file_path": display,
        "format": fmt,
        "bitrate": tags.get("bitrate"),
        "sample_rate": tags.get("sample_rate"),
        "bit_depth": None,
        "duration_ms": int(tags.get("length", 0) * 1000) if tags.get("length") else None,
        "dr_score": None,
        "spectral_ok": None,
        "waveform_path": None,
        "fingerprint": None,
    }
    FILE_DB[file_hash] = record
    _post_to_app(record)
    return record


def scan_library(library_path: str, waveform_path: str, progress_cb: ProgressCb = None) -> int:
    all_files = []
    for root, _, files in os.walk(library_path):
        for fname in files:
            if Path(fname).suffix.lower() in AUDIO_EXTENSIONS:
                all_files.append(os.path.join(root, fname))

    if progress_cb:
        progress_cb(len(all_files), 0, None, None)

    indexed = 0
    for i, path in enumerate(all_files):
        error = None
        try:
            if index_file(path, waveform_path):
                indexed += 1
        except Exception as e:
            error = str(e)
        if progress_cb:
            progress_cb(len(all_files), i + 1, path, error)

    return indexed


def scan_smb(config: dict, waveform_path: str, progress_cb: ProgressCb = None) -> int:
    import smbclient

    host = config.get("host", "")
    share = config.get("share", "")
    username = config.get("username") or None
    password = config.get("password") or None
    domain = config.get("domain") or None
    subfolder = config.get("subfolder", "").strip("/\\")

    effective_user = username
    if effective_user and domain:
        effective_user = f"{domain}\\{effective_user}"
    smbclient.register_session(host, username=effective_user, password=password)

    smb_root = rf"\\{host}\{share}"
    if subfolder:
        smb_root = rf"{smb_root}\{subfolder}"

    # ── Phase 1: Discovery — emit -1 total so caller shows "discovering" UI ──
    all_files: list[str] = []
    try:
        for dirpath, _, files in smbclient.walk(smb_root):
            for fname in files:
                if Path(fname).suffix.lower() in AUDIO_EXTENSIONS:
                    all_files.append(rf"{dirpath}\{fname}")
                    if progress_cb:
                        progress_cb(-1, len(all_files), fname, None)
    except Exception as e:
        print(f"[SMB] walk error: {e}")
        return 0

    if not all_files:
        if progress_cb:
            progress_cb(0, 0, None, None)
        return 0

    # Switch progress to indexing phase
    if progress_cb:
        progress_cb(len(all_files), 0, None, None)

    # ── Phase 2: Fast parallel metadata indexing (4 workers) ─────────────────
    indexed = 0
    done_count = 0
    lock = threading.Lock()

    def process_one(smb_path: str) -> tuple[bool, str, str | None]:
        display = smb_path.replace("\\", "/")
        try:
            record = _smb_fast_index(smb_path, display)
            return (record is not None, display, None)
        except Exception as e:
            print(f"[SMB] index error {smb_path}: {e}")
            return (False, display, str(e))

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(process_one, p): p for p in all_files}
        for fut in as_completed(futures):
            ok, display, error = fut.result()
            with lock:
                done_count += 1
                if ok:
                    indexed += 1
                local_done = done_count
            if progress_cb:
                progress_cb(len(all_files), local_done, display, error)

    return indexed


def scan_source_config(src_type: str, config: dict, waveform_path: str, progress_cb: ProgressCb = None) -> int:
    if src_type in ("local", "nfs", "iscsi"):
        path = config.get("path", "")
        if not path or not os.path.isdir(path):
            print(f"[scanner] path not found: {path}")
            return 0
        return scan_library(path, waveform_path, progress_cb)
    elif src_type == "smb":
        return scan_smb(config, waveform_path, progress_cb)
    else:
        print(f"[scanner] unknown source type: {src_type}")
        return 0


def get_file_record(hash: str) -> dict | None:
    return FILE_DB.get(hash)
