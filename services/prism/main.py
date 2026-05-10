"""
Prism — spectral analysis and fake-FLAC / upscale detector.

Subscribes to: phonolith.hash.created  (Bit-Forge output)
Publishes to:  phonolith.analysis.prism

For each new file, Prism:
  1. Reads the first 30 seconds of audio via soundfile / librosa.
  2. Computes a spectrogram and finds the effective frequency ceiling.
  3. Compares against the container's declared Nyquist limit.
  4. Flags files where the spectrum hard-cuts below the expected ceiling
     — a hallmark of lossy-to-lossless upscaling ("Fake FLAC").
  5. Stores a low-res spectrogram PNG under /data/spectrograms/.
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import librosa
import soundfile as sf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from loguru import logger
import nats

NATS_URL     = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR     = os.getenv("DATA_DIR", "/data")
WORKERS      = int(os.getenv("WORKER_POOL_SIZE", "4"))
SPEC_DIR     = os.path.join(DATA_DIR, "spectrograms")
ANALYSIS_SECS = 30  # analyse first N seconds

os.makedirs(SPEC_DIR, exist_ok=True)

# ── Spectral analysis ─────────────────────────────────────────────────────────

def analyse_file(path: str, declared_sample_rate: int) -> dict:
    """Run in a process pool (CPU-bound)."""
    result = {
        "path": path,
        "status": "clean",
        "fraud_reason": None,
        "spectral_cutoff_hz": None,
        "spectrogram_path": None,
    }

    try:
        y, sr = librosa.load(path, sr=None, duration=ANALYSIS_SECS, mono=True)
        nyquist = sr / 2

        # Short-time Fourier transform
        stft = np.abs(librosa.stft(y, n_fft=4096))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)

        # Find highest frequency bin with meaningful energy (> -60 dBFS)
        mean_power = stft.mean(axis=1)
        db = librosa.amplitude_to_db(mean_power, ref=np.max)
        meaningful = np.where(db > -60)[0]
        cutoff_hz = int(freqs[meaningful[-1]]) if meaningful.size > 0 else 0
        result["spectral_cutoff_hz"] = cutoff_hz

        # Fake-FLAC check:
        # If the file's declared sample rate implies Nyquist > 22 kHz
        # but the actual spectrum cuts off at or below 22 kHz, it likely
        # originated from a 44.1 kHz (or lower) source.
        declared_nyquist = declared_sample_rate / 2
        if declared_nyquist > 22_050 and cutoff_hz <= 22_050:
            result["status"] = "suspect"
            result["fraud_reason"] = (
                f"Spectrum ends at {cutoff_hz:,} Hz but container declares "
                f"{declared_sample_rate:,} Hz ({declared_nyquist:,.0f} Hz Nyquist). "
                "Likely upscaled from a 44.1 kHz source."
            )
            logger.warning(f"⚠ Potential upscale: {Path(path).name} — {result['fraud_reason']}")

        # Save spectrogram PNG
        stem = Path(path).stem[:40]
        spec_path = os.path.join(SPEC_DIR, f"{stem}.png")
        fig, ax = plt.subplots(figsize=(10, 3))
        librosa.display.specshow(
            librosa.amplitude_to_db(stft, ref=np.max),
            sr=sr, x_axis="time", y_axis="hz", ax=ax, cmap="magma"
        )
        ax.set_ylim(0, min(nyquist, 24_000))
        ax.set_title(Path(path).name, fontsize=8)
        plt.tight_layout()
        fig.savefig(spec_path, dpi=72)
        plt.close(fig)
        result["spectrogram_path"] = spec_path

    except Exception as exc:
        logger.error(f"Prism analysis failed for {path}: {exc}")
        result["status"] = "error"
        result["fraud_reason"] = str(exc)

    return result


# ── Message handler ───────────────────────────────────────────────────────────

async def handle_hash_event(msg, js, executor: ProcessPoolExecutor):
    await msg.ack()
    try:
        data = json.loads(msg.data)
        path = data.get("path", "")
        blake3_hash = data.get("blake3_hash", "")
        if not path or not blake3_hash:
            return

        # Infer declared sample rate from mutagen (best effort)
        declared_sr = 96_000  # conservative default
        try:
            import mutagen
            audio = mutagen.File(path, easy=False)
            if audio and hasattr(audio, "info"):
                declared_sr = getattr(audio.info, "sample_rate", 96_000)
        except Exception:
            pass

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            executor, analyse_file, path, declared_sr
        )

        event = {
            "blake3_hash": blake3_hash,
            "path": path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **result,
        }
        await js.publish("phonolith.analysis.prism", json.dumps(event).encode())
        logger.info(f"Prism: {Path(path).name} → {result['status']}")
    except Exception as exc:
        logger.error(f"handle_hash_event error: {exc}")


async def main():
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()

    logger.info(f"Prism starting — spectral analysis engine (workers={WORKERS})")

    executor = ProcessPoolExecutor(max_workers=WORKERS)

    try:
        await js.add_stream(
            name="PHONOLITH_ANALYSIS",
            subjects=["phonolith.analysis.>"],
        )
    except Exception:
        pass

    async def _cb_hash(m): await handle_hash_event(m, js, executor)
    await js.subscribe("phonolith.hash.created", durable="prism", cb=_cb_hash)

    logger.info("Prism listening for hash events")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Prism shutting down")
