def compute_accuraterip_crc(path: str) -> str | None:
    """
    Compute AccurateRip CRCv1 for a single audio file.
    Returns hex string of the 32-bit CRC, or None on error.
    """
    try:
        import soundfile as sf
        import numpy as np
        data, sr = sf.read(path, dtype='int32', always_2d=True)
        # Convert to mono-average if stereo
        if data.shape[1] >= 2:
            samples = ((data[:, 0].astype(np.int64) + data[:, 1].astype(np.int64)) // 2).astype(np.uint32)
        else:
            samples = data[:, 0].astype(np.uint32)

        crc = np.uint32(0)
        for i, sample in enumerate(samples):
            crc += np.uint32(sample) * np.uint32(i + 1)
        return format(int(crc), '08x')
    except Exception as e:
        print(f"[AccurateRip] CRC error: {e}")
        return None


def verify_track(path: str) -> dict:
    """
    Returns dict with: crc, status ('computed'|'error'), note
    Full disc verification requires a CUE sheet — not available for individual files.
    """
    crc = compute_accuraterip_crc(path)
    if not crc:
        return {'status': 'error', 'crc': None, 'note': 'Could not compute CRC'}
    return {
        'status': 'computed',
        'crc': crc,
        'note': 'CRC computed. Full AccurateRip verification requires disc CUE context.',
    }
