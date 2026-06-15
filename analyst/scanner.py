import hashlib
import io
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable
import httpx

import os as _os
try:
    _os.nice(10)  # Analyst runs at low priority — never compete with Lucid for CPU
except (AttributeError, PermissionError):
    pass

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


def _parse_disc_number(raw: str | None) -> int | None:
    """Parse disc number from tag value like '1' or '1/2', returning the integer part."""
    if not raw:
        return None
    try:
        return int(str(raw).split("/")[0].strip())
    except (ValueError, AttributeError):
        return None


def _read_tags(fileobj_or_path) -> dict:
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(fileobj_or_path, easy=True)
        if not audio:
            return {}
        info = audio.info

        # disc_number: try Vorbis 'discnumber' first, then easy-tag 'disk'
        disc_raw = None
        if audio.get("discnumber"):
            disc_raw = str(audio.get("discnumber", [""])[0])
        elif audio.get("disk"):
            disc_raw = str(audio.get("disk", [""])[0])
        disc_number = _parse_disc_number(disc_raw)

        return {
            "title": str(audio.get("title", [""])[0]) if audio.get("title") else None,
            "artist": str(audio.get("artist", [""])[0]) if audio.get("artist") else None,
            "album": str(audio.get("album", [""])[0]) if audio.get("album") else None,
            "year": str(audio.get("date", [""])[0])[:4] if audio.get("date") else None,
            "track": str(audio.get("tracknumber", [""])[0]) if audio.get("tracknumber") else None,
            "disc_number": disc_number,
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
    output = os.path.join(waveform_path, file_hash[0:2], file_hash[2:4], f"{file_hash}.png")
    os.makedirs(os.path.dirname(output), exist_ok=True)
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


def _render_cover_art(path_or_fileobj, file_hash: str, waveform_path: str) -> str | None:
    """
    Extract embedded cover art from a local file path or a BytesIO buffer.
    Saves as a sharded JPEG at quality=85. Returns the output path or None.
    """
    output = os.path.join(waveform_path, file_hash[0:2], file_hash[2:4], f"{file_hash}_cover.jpg")
    os.makedirs(os.path.dirname(output), exist_ok=True)
    if os.path.exists(output):
        return output

    art_data: bytes | None = None

    try:
        from mutagen import File as MutagenFile

        # For BytesIO buffers, seek to start before reading
        if hasattr(path_or_fileobj, "read"):
            path_or_fileobj.seek(0)

        audio = MutagenFile(path_or_fileobj)
        if not audio:
            return None

        # ID3 tags (MP3, AIFF, etc.) — APIC frames
        if hasattr(audio, "tags") and audio.tags:
            from mutagen.id3 import APIC
            for key in audio.tags.keys():
                if key.startswith("APIC"):
                    frame = audio.tags[key]
                    art_data = frame.data
                    break

        # FLAC / Vorbis — METADATA_BLOCK_PICTURE
        if art_data is None and hasattr(audio, "pictures"):
            pics = audio.pictures
            if pics:
                art_data = pics[0].data

        # MP4/AAC — covr atom
        if art_data is None:
            covr = audio.get("covr") if hasattr(audio, "get") else None
            if covr:
                art_data = bytes(covr[0])

    except Exception:
        return None

    if not art_data:
        return None

    try:
        from PIL import Image
        img = Image.open(io.BytesIO(art_data))
        img = img.convert("RGB")
        img.save(output, "JPEG", quality=85)
        return output
    except Exception:
        return None


def _post_to_app(data: dict) -> None:
    try:
        httpx.post(f"{APP_URL}/api/library/ingest", json=data, timeout=10)
    except Exception:
        pass


def ensure_root_marker(source_root: str, marker_uuid: str) -> bool:
    """Write .phonolith_id to source root if not present. Returns True if writable."""
    marker_path = os.path.join(source_root, ".phonolith_id")
    try:
        if not os.path.exists(marker_path):
            with open(marker_path, "w") as f:
                f.write(marker_uuid)
        return True
    except OSError:
        return False


def check_root_marker(source_root: str, expected_uuid: str | None) -> bool:
    """Returns True if source root is accessible (and marker matches if provided)."""
    marker_path = os.path.join(source_root, ".phonolith_id")
    try:
        if expected_uuid:
            with open(marker_path) as f:
                return f.read().strip() == expected_uuid
        return os.path.exists(marker_path) or os.path.isdir(source_root)
    except (OSError, IOError):
        return os.path.isdir(source_root)


def index_file(
    path: str,
    waveform_path: str,
    display_path: str | None = None,
    source_id: int | None = None,
    source_root: str | None = None,
) -> dict | None:
    """Full analysis: hash + tags + librosa DR + waveform. Used for local sources."""
    try:
        h = _hash_file(path)
        tags = _read_tags(path)
        fmt = Path(display_path or path).suffix.lower().lstrip(".")
        bit_depth = _detect_bit_depth(path)
        dr = _compute_dr(path)
        spectral_ok = _detect_upscale(path)
        waveform = _render_waveform(path, h, waveform_path)
        cover_art = _render_cover_art(path, h, waveform_path)
        try:
            import acoustid
            raw_fp = acoustid.fingerprint_file(path)
            fp = raw_fp[1].decode() if isinstance(raw_fp[1], bytes) else raw_fp[1]
        except Exception:
            fp = None

        # AccurateRip CRC (FLAC and WAV only — needs uncompressed PCM access)
        accuraterip_result = None
        if fmt in ('flac', 'wav', 'aiff'):
            try:
                from accuraterip import verify_track
                dur_ms = int(tags.get("length", 0) * 1000) if tags.get("length") else None
                accuraterip_result = verify_track(path, dur_ms)
            except Exception:
                pass

        # Stat fields for fast-path identity check
        try:
            st = os.stat(path)
            inode = st.st_ino
            file_size = st.st_size
            mtime = int(st.st_mtime)
        except OSError:
            inode = file_size = mtime = None

        # Relative path computation
        relative_path = None
        if source_root and path.startswith(source_root):
            relative_path = os.path.relpath(path, source_root)

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
            "accuraterip_crc": accuraterip_result.get('crc') if accuraterip_result else None,
            "accuraterip_status": accuraterip_result.get('status') if accuraterip_result else None,
            "source_id": source_id,
            "relative_path": relative_path,
            "inode": inode,
            "file_size": file_size,
            "mtime": mtime,
            "title": tags.get("title"),
            "artist": tags.get("artist"),
            "album": tags.get("album"),
            "year": tags.get("year"),
            "disc_number": tags.get("disc_number", 1),
            "cover_art_path": cover_art,
        }
        FILE_DB[h] = record
        _post_to_app(record)
        return record
    except Exception:
        return None


def _smb_fast_index(
    smb_path: str,
    display: str,
    waveform_path: str = "",
    source_id: int | None = None,
    smb_root: str | None = None,
) -> dict | None:
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

    # Extract cover art from the buffered header (512 KB is enough for embedded art)
    cover_art = None
    if waveform_path:
        cover_art = _render_cover_art(header_buf, file_hash, waveform_path)

    # Relative path computation for SMB
    relative_path = None
    if smb_root and smb_path.startswith(smb_root):
        relative_path = smb_path[len(smb_root):].lstrip("\\/").replace("\\", "/")

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
        "source_id": source_id,
        "relative_path": relative_path,
        "title": tags.get("title"),
        "artist": tags.get("artist"),
        "album": tags.get("album"),
        "year": tags.get("year"),
        "disc_number": tags.get("disc_number", 1),
        "cover_art_path": cover_art,
    }
    FILE_DB[file_hash] = record
    _post_to_app(record)
    return record


def scan_library(
    library_path: str,
    waveform_path: str,
    progress_cb: ProgressCb = None,
    source_id: int | None = None,
    marker_uuid: str | None = None,
) -> int:
    if source_id is not None:
        ensure_root_marker(library_path, marker_uuid or "default")

    source_root = library_path

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
            if index_file(path, waveform_path, source_id=source_id, source_root=source_root):
                indexed += 1
        except Exception as e:
            error = str(e)
        if progress_cb:
            progress_cb(len(all_files), i + 1, path, error)

    return indexed


def scan_smb(
    config: dict,
    waveform_path: str,
    progress_cb: ProgressCb = None,
    source_id: int | None = None,
) -> int:
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
            record = _smb_fast_index(
                smb_path,
                display,
                waveform_path=waveform_path,
                source_id=source_id,
                smb_root=smb_root,
            )
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


def scan_source_config(
    src_type: str,
    config: dict,
    waveform_path: str,
    progress_cb: ProgressCb = None,
    source_id: int | None = None,
) -> int:
    if src_type in ("local", "nfs", "iscsi"):
        path = config.get("path", "")
        if not path or not os.path.isdir(path):
            print(f"[scanner] path not found: {path}")
            return 0
        return scan_library(path, waveform_path, progress_cb, source_id=source_id)
    elif src_type == "smb":
        return scan_smb(config, waveform_path, progress_cb, source_id=source_id)
    else:
        print(f"[scanner] unknown source type: {src_type}")
        return 0


def get_file_record(hash: str) -> dict | None:
    return FILE_DB.get(hash)
