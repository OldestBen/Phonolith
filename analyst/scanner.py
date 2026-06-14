import os
import hashlib
import json
from pathlib import Path
import httpx

APP_URL = os.environ.get("APP_URL", "http://app:3000")

AUDIO_EXTENSIONS = {'.flac', '.mp3', '.aac', '.m4a', '.ogg', '.wav', '.aiff', '.wv', '.ape', '.opus'}

FILE_DB: dict[str, dict] = {}


def blake3_hash(path: str) -> str:
    try:
        import blake3
        h = blake3.blake3()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()
    except ImportError:
        # Fallback to SHA-256 if blake3 unavailable
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
        nyquist = sr / 2

        # Check if energy above 18kHz is suspiciously low relative to below
        mask_hi = freqs > 18000
        mask_lo = (freqs > 1000) & (freqs < 18000)
        if mask_hi.sum() == 0 or mask_lo.sum() == 0:
            return None

        energy_hi = np.mean(fft[mask_hi] ** 2)
        energy_lo = np.mean(fft[mask_lo] ** 2)
        # If ratio < 1e-6, likely upscaled
        ratio = energy_hi / (energy_lo + 1e-12)
        return ratio > 1e-6  # True = spectral OK (no upscale detected)
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

        # Downsample to width
        chunk = max(1, len(y) // W)
        peaks = [float(np.max(np.abs(y[i*chunk:(i+1)*chunk]))) for i in range(W)]
        max_peak = max(peaks) or 1

        for x, peak in enumerate(peaks):
            h = int((peak / max_peak) * (H // 2 - 2))
            mid = H // 2
            # Gradient from accent to dim
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


def index_file(path: str, waveform_path: str) -> dict | None:
    try:
        h = blake3_hash(path)
        tags = read_tags(path)
        fmt = detect_format(path)
        bit_depth = detect_bit_depth(path)
        dr = compute_dr_score(path)
        spectral_ok = detect_upscale(path)
        waveform = render_waveform(path, h, waveform_path)
        fp = get_fingerprint_data(path)

        record = {
            "blake3_hash": h,
            "file_path": path,
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


def scan_library(library_path: str, waveform_path: str) -> int:
    indexed = 0
    for root, _, files in os.walk(library_path):
        for fname in files:
            if Path(fname).suffix.lower() in AUDIO_EXTENSIONS:
                path = os.path.join(root, fname)
                result = index_file(path, waveform_path)
                if result:
                    indexed += 1
    return indexed


def get_file_record(hash: str) -> dict | None:
    return FILE_DB.get(hash)
