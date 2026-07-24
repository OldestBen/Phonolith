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
