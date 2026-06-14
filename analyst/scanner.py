import os
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Callable
import httpx

APP_URL = os.environ.get("APP_URL", "http://app:3000")

AUDIO_EXTENSIONS = {'.flac', '.mp3', '.aac', '.m4a', '.ogg', '.wav', '.aiff', '.wv', '.ape', '.opus'}

FILE_DB: dict[str, dict] = {}

ProgressCb = Callable[[int, int, str | None, str | None], None] | None


def blake3_hash(path: str) -> str:
    try:
        import blake3
        h = blake3.blake3()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()
    except ImportError:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()


def read_tags(path: str) -> dict:
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path, easy=True)
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


def detect_format(path: str) -> str:
    ext = Path(path).suffix.lower().lstrip(".")
    return ext or "unknown"


def detect_bit_depth(path: str) -> int | None:
    try:
        from mutagen.flac import FLAC
        if path.lower().endswith(".flac"):
            audio = FLAC(path)
            return audio.info.bits_per_sample
    except Exception:
        pass
    return None


def compute_dr_score(path: str) -> float | None:
    try:
        import numpy as np
        import librosa
        y, sr = librosa.load(path, sr=None, mono=True, duration=60)
        if len(y) == 0:
            return None
        rms = np.sqrt(np.mean(y ** 2))
        peak = np.max(np.abs(y))
        if rms < 1e-10:
            return None
        crest = 20 * np.log10(peak / rms)
        return round(float(crest), 2)
    except Exception:
        return None


def detect_upscale(path: str) -> bool | None:
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
        energy_hi = np.mean(fft[mask_hi] ** 2)
        energy_lo = np.mean(fft[mask_lo] ** 2)
        ratio = energy_hi / (energy_lo + 1e-12)
        return ratio > 1e-6
    except Exception:
        return None


def render_waveform(path: str, hash: str, waveform_path: str) -> str | None:
    output = os.path.join(waveform_path, f"{hash}.png")
    if os.path.exists(output):
        return output
    try:
        import numpy as np
        import librosa
        from PIL import Image, ImageDraw
        y, sr = librosa.load(path, sr=None, mono=True, duration=120)
        W, H = 1200, 200
        img = Image.new("RGB", (W, H), "#08080a")
        draw = ImageDraw.Draw(img)
        chunk = max(1, len(y) // W)
        peaks = [float(np.max(np.abs(y[i*chunk:(i+1)*chunk]))) for i in range(W)]
        max_peak = max(peaks) or 1
        for x, peak in enumerate(peaks):
            h = int((peak / max_peak) * (H // 2 - 2))
            mid = H // 2
            draw.line([(x, mid - h), (x, mid + h)], fill="#a78bfa", width=1)
        img.save(output, "PNG")
        return output
    except Exception:
        return None


def get_fingerprint_data(path: str) -> str | None:
    try:
        import acoustid
        duration, fp = acoustid.fingerprint_file(path)
        return fp.decode() if isinstance(fp, bytes) else fp
    except Exception:
        return None


def post_to_app(data: dict) -> None:
    try:
        httpx.post(f"{APP_URL}/api/library/ingest", json=data, timeout=10)
    except Exception:
        pass


def index_file(path: str, waveform_path: str, display_path: str | None = None) -> dict | None:
    try:
        h = blake3_hash(path)
        tags = read_tags(path)
        fmt = detect_format(display_path or path)
        bit_depth = detect_bit_depth(path)
        dr = compute_dr_score(path)
        spectral_ok = detect_upscale(path)
        waveform = render_waveform(path, h, waveform_path)
        fp = get_fingerprint_data(path)

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
        post_to_app(record)
        return record
    except Exception:
        return None


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
            result = index_file(path, waveform_path)
            if result:
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

    all_files: list[str] = []
    try:
        for dirpath, _, files in smbclient.walk(smb_root):
            for fname in files:
                if Path(fname).suffix.lower() in AUDIO_EXTENSIONS:
                    all_files.append(rf"{dirpath}\{fname}")
    except Exception as e:
        print(f"[SMB] walk error: {e}")
        return 0

    if progress_cb:
        progress_cb(len(all_files), 0, None, None)

    indexed = 0
    for i, smb_path in enumerate(all_files):
        error = None
        try:
            suffix = Path(smb_path.replace("\\", "/")).suffix
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                with smbclient.open_file(smb_path, mode="rb") as f:
                    tmp.write(f.read())
                tmp_path = tmp.name
            try:
                display = smb_path.replace("\\", "/")
                result = index_file(tmp_path, waveform_path, display_path=display)
                if result:
                    indexed += 1
            finally:
                os.unlink(tmp_path)
        except Exception as e:
            error = str(e)
            print(f"[SMB] error indexing {smb_path}: {e}")

        if progress_cb:
            progress_cb(len(all_files), i + 1, smb_path.replace("\\", "/"), error)

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
