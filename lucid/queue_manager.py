"""
queue_manager.py — Simple in-memory playback queue for Lucid.

Tracks an ordered list of absolute file paths and a current position
pointer, providing next/prev navigation and basic mutation operations.
"""

from __future__ import annotations

import logging

log = logging.getLogger("lucid.queue")


class QueueManager:
    """
    In-memory playback queue.

    Attributes
    ----------
    tracks:
        Ordered list of absolute file paths.
    position:
        Zero-based index of the currently active track.
        ``-1`` indicates an empty or unstarted queue.
    """

    def __init__(self) -> None:
        self.tracks: list[str] = []
        self.position: int = -1

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def current(self) -> str | None:
        """Return the path of the currently active track, or ``None``."""
        if not self.tracks or self.position < 0 or self.position >= len(self.tracks):
            return None
        return self.tracks[self.position]

    # ------------------------------------------------------------------
    # Navigation
    # ------------------------------------------------------------------

    def next(self) -> str | None:
        """
        Advance the queue position by one and return the next track path.

        Returns ``None`` and does not advance past the end of the queue.
        """
        if not self.tracks:
            return None
        next_pos = self.position + 1
        if next_pos >= len(self.tracks):
            log.debug("Queue exhausted — no next track")
            return None
        self.position = next_pos
        log.debug("Queue advanced to position %d: %s", self.position, self.tracks[self.position])
        return self.tracks[self.position]

    def prev(self) -> str | None:
        """
        Move the queue position back by one and return the previous track path.

        Returns ``None`` and does not move before the start of the queue.
        """
        if not self.tracks:
            return None
        prev_pos = self.position - 1
        if prev_pos < 0:
            log.debug("Already at start of queue — no previous track")
            return None
        self.position = prev_pos
        log.debug("Queue moved back to position %d: %s", self.position, self.tracks[self.position])
        return self.tracks[self.position]

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def enqueue(self, path: str) -> None:
        """Append *path* to the end of the queue."""
        self.tracks.append(path)
        # If the queue was empty, point at the newly added track.
        if self.position < 0:
            self.position = 0
        log.debug("Enqueued: %s (queue length: %d)", path, len(self.tracks))

    def clear(self) -> None:
        """Remove all tracks and reset the position pointer."""
        self.tracks = []
        self.position = -1
        log.debug("Queue cleared")

    def set_tracks(self, paths: list[str]) -> None:
        """
        Replace the entire queue with *paths* and reset the position to 0.

        If *paths* is empty the position is set to ``-1``.
        """
        self.tracks = list(paths)
        self.position = 0 if self.tracks else -1
        log.debug("Queue set to %d tracks", len(self.tracks))

    # ------------------------------------------------------------------
    # Dunder helpers
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return len(self.tracks)

    def __repr__(self) -> str:
        return (
            f"QueueManager(tracks={len(self.tracks)}, position={self.position}, "
            f"current={self.current()!r})"
        )
