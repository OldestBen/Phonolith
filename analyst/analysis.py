def compute_dr_score(path: str) -> float | None:
    try:
        import numpy as np
        import librosa
        y, sr = librosa.load(path, sr=None, mono=True, duration=60)
        if len(y) == 0:
            return None
        rms = float(np.sqrt(np.mean(y ** 2)))
        peak = float(np.max(np.abs(y)))
        if rms < 1e-10:
            return None
        return round(20 * np.log10(peak / rms), 2)
    except Exception:
        return None


def detect_upscale(path: str) -> bool | None:
    try:
        import numpy as np
        import librosa
        y, sr = librosa.load(path, sr=None, mono=True, duration=30)
        freqs = np.fft.rfftfreq(len(y), 1 / sr)
        fft = np.abs(np.fft.rfft(y))
        mask_hi = freqs > 18000
        mask_lo = (freqs > 1000) & (freqs < 18000)
        if not mask_hi.any() or not mask_lo.any():
            return None
        ratio = np.mean(fft[mask_hi] ** 2) / (np.mean(fft[mask_lo] ** 2) + 1e-12)
        return bool(ratio > 1e-6)
    except Exception:
        return None
