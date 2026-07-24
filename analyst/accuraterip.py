import struct


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


def lookup_single_track(path: str, crc_hex: str, duration_ms: int) -> dict:
    """
    Attempt AccurateRip lookup assuming a single-track disc configuration.

    For a single-track disc:
      - Track is at LBA 0, leadout at frame_count (75 frames/sec CD rate)
      - disc_id1 = frame_count
      - disc_id2 = frame_count * 1  (weighted offset sum for track 1)
      - cddb_id  = ((frame_count + 150) // 75) % 255  (simplified)

    Returns dict with status: 'verified', 'mismatch', 'not_found', or 'error'.
    """
    import httpx

    try:
        frame_count = int(duration_ms * 75 / 1000)
        disc_id1 = frame_count
        disc_id2 = frame_count * 1
        cddb_id = ((frame_count + 150) // 75) % 255

        # Build URL: c1/c2/c3 are first 3 hex digits of disc_id1
        disc_id1_hex = format(disc_id1, '08x')
        c1, c2, c3 = disc_id1_hex[0], disc_id1_hex[1], disc_id1_hex[2]
        url = (
            f"http://www.accuraterip.com/accuraterip/{c1}/{c2}/{c3}/"
            f"dBAR-001-{disc_id1_hex}-{format(disc_id2, '08x')}-{format(cddb_id, '08x')}.bin"
        )

        try:
            response = httpx.get(url, timeout=5.0)
        except Exception as e:
            return {'status': 'error', 'crc': crc_hex, 'note': f'Network error: {e}'}

        if response.status_code == 404:
            return {'status': 'not_found', 'crc': crc_hex}

        if response.status_code != 200:
            return {
                'status': 'error',
                'crc': crc_hex,
                'note': f'Unexpected HTTP {response.status_code}',
            }

        # Parse binary data
        # Each chunk: 1 (track_count) + 4 (disc_id1 LE) + 4 (disc_id2 LE) + 4 (cddb_id LE) = 13 bytes header
        # Then for each track: 1 (confidence) + 4 (crc_v1 LE) + 4 (crc_v2 LE) = 9 bytes
        data = response.content
        our_crc = int(crc_hex, 16)
        offset = 0
        our_crc_int = our_crc

        while offset < len(data):
            if offset + 13 > len(data):
                break

            track_count = data[offset]
            # disc IDs at offset+1 and offset+5 (4 bytes each) — parsed here to
            # document the 13-byte header layout; not used for the CRC match itself.
            _chunk_disc_id1 = struct.unpack_from('<I', data, offset + 1)[0]
            _chunk_disc_id2 = struct.unpack_from('<I', data, offset + 5)[0]
            # cddb_id at offset + 9 (4 bytes)
            offset += 13

            # Each track entry is 9 bytes: confidence(1) + crc_v1(4) + crc_v2(4)
            track_data_size = track_count * 9
            if offset + track_data_size > len(data):
                break

            # We care about track 1 (index 0) since this is a single-track disc lookup
            for t in range(track_count):
                confidence = data[offset + t * 9]
                ar_crc_v1 = struct.unpack_from('<I', data, offset + t * 9 + 1)[0]
                # crc_v2 at offset + t*9 + 5 (not used for v1 match)

                if t == 0:  # track 1
                    if ar_crc_v1 == our_crc_int:
                        return {
                            'status': 'verified',
                            'confidence': confidence,
                            'crc': crc_hex,
                        }
                    # Not a match — keep checking other chunks (multiple pressings
                    # may be listed). A mismatch is reported after the re-parse below.

            offset += track_data_size

        # If we got here, we had data but no CRC matched — report mismatch with last seen AR CRC
        # Re-parse to find any track-1 CRC to report
        offset = 0
        while offset < len(data):
            if offset + 13 > len(data):
                break
            track_count = data[offset]
            offset += 13
            track_data_size = track_count * 9
            if offset + track_data_size > len(data):
                break
            ar_crc_v1 = struct.unpack_from('<I', data, offset + 1)[0]
            return {
                'status': 'mismatch',
                'crc': crc_hex,
                'ar_crc': format(ar_crc_v1, '08x'),
            }

        return {'status': 'not_found', 'crc': crc_hex}

    except Exception as e:
        return {'status': 'error', 'crc': crc_hex, 'note': f'Lookup error: {e}'}


def verify_track(path: str, duration_ms: int | None = None) -> dict:
    """
    Returns dict with: crc, status ('computed'|'verified'|'mismatch'|'not_found'|'error'|'no_disc_context')

    If duration_ms is provided, attempts a single-track disc lookup against the
    AccurateRip HTTP database. Without duration_ms (or a CUE sheet), only the
    CRC can be computed — full disc verification is not possible.
    """
    crc = compute_accuraterip_crc(path)
    if not crc:
        return {'status': 'error', 'crc': None, 'note': 'Could not compute CRC'}

    if duration_ms is not None and duration_ms > 0:
        return lookup_single_track(path, crc, duration_ms)

    # Try to get duration from soundfile if not supplied
    if duration_ms is None:
        try:
            import soundfile as sf
            info = sf.info(path)
            computed_ms = int(info.duration * 1000)
            if computed_ms > 0:
                return lookup_single_track(path, crc, computed_ms)
        except Exception:
            pass

    return {
        'status': 'no_disc_context',
        'crc': crc,
        'note': 'CRC computed. Full AccurateRip verification requires disc CUE context or duration.',
    }
