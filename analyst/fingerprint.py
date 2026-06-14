def get_fingerprint(path: str) -> str | None:
    try:
        import acoustid
        duration, fp = acoustid.fingerprint_file(path)
        return fp.decode() if isinstance(fp, bytes) else str(fp)
    except Exception:
        return None
