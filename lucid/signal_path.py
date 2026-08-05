"""
signal_path.py — Manages the Lucid signal chain state.

Tracks every stage of the audio path from source file through decoder,
DSP chain, and ALSA transport, publishing updates to Redis for the
Phonolith frontend to consume.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from typing import Any

log = logging.getLogger("lucid.signal_path")


@dataclass
class SignalPath:
    source_file: str | None = None
    source_format: str | None = None       # "FLAC", "MP3", etc.
    source_bit_depth: int | None = None    # 16, 24, 32
    source_sample_rate: int | None = None  # 44100, 96000, etc.
    source_channels: int = 2
    decoder: str | None = None             # "libFLAC (via soundfile)", "FFmpeg", "PCM native"
    dsp_chain: list[str] = field(default_factory=list)  # e.g. ["Volume: 100%"]
    transport: str = "ALSA Exclusive"
    alsa_device: str = "default"
    endpoint_name: str | None = None       # User-friendly name e.g. "Chord Hugo TT2"
    status: str = "stopped"               # "playing"|"paused"|"stopped"|"buffering"|"error"
    position_ms: int = 0
    duration_ms: int = 0
    volume: float = 1.0                   # 0.0 – 1.0 (software volume; ideally 1.0 always)
    bit_perfect: bool = True              # False if any resampling/conversion happened


class SignalPathManager:
    """
    Wraps a :class:`SignalPath` instance, providing update, serialisation,
    and Redis publish helpers.
    """

    REDIS_KEY = "lucid:signal_path"
    REDIS_CHANNEL = "lucid:signal_path:update"

    def __init__(self) -> None:
        self._sp = SignalPath()

    # ------------------------------------------------------------------
    # Public accessors
    # ------------------------------------------------------------------

    @property
    def signal_path(self) -> SignalPath:
        return self._sp

    def to_dict(self) -> dict[str, Any]:
        """Return the current :class:`SignalPath` as a plain dictionary."""
        return asdict(self._sp)

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def update(self, **kwargs: Any) -> None:
        """
        Update one or more fields on the current :class:`SignalPath`.

        Automatically sets ``bit_perfect = False`` if ``source_sample_rate``
        or ``source_bit_depth`` is changed to a value that differs from the
        original source values already stored on the path.
        """
        sp = self._sp

        # Snapshot original source values before applying changes.
        original_rate = sp.source_sample_rate
        original_depth = sp.source_bit_depth

        for key, value in kwargs.items():
            if not hasattr(sp, key):
                log.warning("SignalPath has no field %r — ignoring", key)
                continue
            setattr(sp, key, value)

        # If the caller changed rate/depth AND we already had source values,
        # flag that bit-perfect playback is no longer guaranteed.
        new_rate = sp.source_sample_rate
        new_depth = sp.source_bit_depth

        if original_rate is not None and new_rate != original_rate:
            sp.bit_perfect = False
        if original_depth is not None and new_depth != original_depth:
            sp.bit_perfect = False

        log.debug("SignalPath updated: %s", self.to_dict())

    # ------------------------------------------------------------------
    # Redis persistence / pub-sub
    # ------------------------------------------------------------------

    def publish(self, redis_client: Any) -> None:
        """
        Serialise the current signal path to JSON, write it to the Redis key
        ``lucid:signal_path`` (no expiry), and publish a notification to
        channel ``lucid:signal_path:update``.

        :param redis_client: A ``redis.Redis`` synchronous client instance.
        """
        payload = json.dumps(self.to_dict())
        try:
            redis_client.set(self.REDIS_KEY, payload)
            redis_client.publish(self.REDIS_CHANNEL, payload)
        except Exception:
            log.exception("Failed to publish signal path to Redis")
