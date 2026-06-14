import os


def render_waveform(path: str, hash: str, waveform_dir: str) -> str | None:
    output = os.path.join(waveform_dir, f"{hash}.png")
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
        peaks = [float(np.max(np.abs(y[i * chunk:(i + 1) * chunk]))) for i in range(W)]
        max_peak = max(peaks) or 1
        mid = H // 2

        for x, peak in enumerate(peaks):
            h = int((peak / max_peak) * (mid - 4))
            draw.line([(x, mid - h), (x, mid + h)], fill="#a78bfa", width=1)

        img.save(output, "PNG", optimize=True)
        return output
    except Exception:
        return None
