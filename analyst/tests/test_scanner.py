"""Unit tests for the analyst scanner's pure tag-parsing helpers.

These cover the exact class of logic where the track_number ingest bug lived:
turning raw, possibly-malformed embedded tag values into clean integers (or
None) without ever raising. No mutagen/httpx/librosa needed — the helpers are
pure, and scanner.py imports those heavy deps lazily.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scanner import _parse_disc_number, _parse_track_number  # noqa: E402


class TestParseTrackNumber:
    def test_plain_integer(self):
        assert _parse_track_number("3") == 3

    def test_slash_total_notation(self):
        assert _parse_track_number("3/12") == 3

    def test_whitespace_is_stripped(self):
        assert _parse_track_number("  7 ") == 7

    def test_none_returns_none(self):
        assert _parse_track_number(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_track_number("") is None

    def test_garbage_returns_none(self):
        assert _parse_track_number("not-a-number") is None

    def test_integer_input(self):
        assert _parse_track_number(5) == 5


class TestScanLibraryUsesFastPath:
    """scan_library must use the fast indexer (tags only) for incremental
    visibility, NOT the heavy per-file analysis. This locks in that wiring so a
    refactor can't silently send local scans back down the slow index_file path.
    """

    def test_scan_library_calls_fast_indexer_not_full(self, monkeypatch, tmp_path):
        import scanner

        # A nested artist/album/song tree with two audio files + one non-audio.
        album = tmp_path / "Aphex Twin" / "SAW 85-92"
        album.mkdir(parents=True)
        (album / "01 Xtal.flac").write_bytes(b"fake")
        (album / "02 Tha.flac").write_bytes(b"fake")
        (album / "cover.jpg").write_bytes(b"notaudio")

        calls = {"fast": 0, "full": 0}
        monkeypatch.setattr(scanner, "_fast_index_local",
                            lambda *a, **k: calls.__setitem__("fast", calls["fast"] + 1) or {"blake3_hash": "h"})
        monkeypatch.setattr(scanner, "index_file",
                            lambda *a, **k: calls.__setitem__("full", calls["full"] + 1) or {"blake3_hash": "h"})
        monkeypatch.setattr(scanner, "_fetch_known_identities", lambda: frozenset())

        indexed = scanner.scan_library(str(tmp_path), str(tmp_path))

        assert calls["fast"] == 2   # both audio files went through the fast path
        assert calls["full"] == 0   # none went through the heavy analysis
        assert indexed == 2         # the .jpg was ignored


class TestParseDiscNumber:
    def test_plain_integer(self):
        assert _parse_disc_number("1") == 1

    def test_slash_total_notation(self):
        assert _parse_disc_number("1/2") == 1

    def test_none_returns_none(self):
        assert _parse_disc_number(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_disc_number("") is None

    def test_garbage_returns_none(self):
        assert _parse_disc_number("disc one") is None
