"""
player.py — ALSA exclusive playback engine for Lucid.

Opens audio files via soundfile (FLAC, WAV, AIFF, OPUS, etc.) or routes
through an FFmpeg subprocess for formats that soundfile cannot decode
(MP3, AAC, M4A, etc.).  Audio is written directly to an ALSA PCM device in
exclusive mode with no intervening mixer, preserving bit-perfect output.

On non-Linux hosts (or when pyalsaaudio is unavailable) a :class:`StubPCM`
is used so the module can be imported for type-checking and tests.
"""

from __future__ import annotations

import logging
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import soundfile as sf

from signal_path import SignalPathManager
from queue_manager import QueueManager

log = logging.getLogger("lucid.player")

# ── ALSA import with graceful fallback ─────────────────────────────────────────

try:
    import alsaaudio  # type: ignore[import]
    _ALSA_AVAILABLE = True
except ImportError:
    _ALSA_AVAILABLE = False
    log.warning(
        "pyalsaaudio not available — using StubPCM (audio output disabled). "
        "This is expected on non-Linux hosts."
    )


class StubPCM:
    """No-op PCM replacement used when ALSA is unavailable."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        log.info("StubPCM created (no audio output)")

    def setformat(self, fmt: Any) -> None:  # noqa: ARG002
        pass

    def setchannels(self, channels: int) -> None:  # noqa: ARG002
        pass

    def setrate(self, rate: int) -> None:  # noqa: ARG002
        pass

    def setperiodsize(self, size: int) -> None:  # noqa: ARG002
        pass

    def write(self, data: bytes) -> int:
        log.debug("StubPCM.write: %d bytes (discarded)", len(data))
        return len(data)

    def close(self) -> None:
        log.debug("StubPCM.close()")


# ── Format helpers ─────────────────────────────────────────────────────────────

_SF_TO_ALSA_FMT: dict[int, Any] = {}  # populated below once ALSA is imported

def _build_format_map() -> None:
    if not _ALSA_AVAILABLE:
        return
    _SF_TO_ALSA_FMT.update({
        16: alsaaudio.PCM_FORMAT_S16_LE,
        24: alsaaudio.PCM_FORMAT_S24_LE,
        32: alsaaudio.PCM_FORMAT_S32_LE,
    })


_build_format_map()


def _alsa_format_for_depth(bit_depth: int) -> Any:
    """Return the ALSA PCM format constant for the given *bit_depth*.

    Falls back to S16_LE if the depth is unrecognised.
    """
    if not _ALSA_AVAILABLE:
        return None
    fmt = _SF_TO_ALSA_FMT.get(bit_depth)
    if fmt is None:
        log.warning("Unrecognised bit depth %d — falling back to S16_LE", bit_depth)
        fmt = alsaaudio.PCM_FORMAT_S16_LE
    return fmt


def _decoder_name(file_path: str) -> str:
    """Return a human-readable decoder name based on the file extension."""
    suffix = Path(file_path).suffix.lower()
    if suffix == ".flac":
        return "libFLAC (via soundfile)"
    if suffix in {".wav", ".aiff", ".aif"}:
        return "PCM native"
    # Everything else goes through FFmpeg
    return "FFmpeg"


# ── FFmpeg PCM pipe helper ─────────────────────────────────────────────────────

def _open_via_ffmpeg(
    file_path: str,
    sample_rate: int,
    channels: int,
    bit_depth: int,
) -> subprocess.Popen[bytes]:
    """
    Spawn an FFmpeg process that decodes *file_path* to raw signed-integer PCM
    on stdout.

    Returns an open :class:`subprocess.Popen` object.  The caller is
    responsible for reading ``proc.stdout`` and calling ``proc.wait()``.
    """
    fmt_map = {16: "s16le", 24: "s24le", 32: "s32le"}
    pcm_fmt = fmt_map.get(bit_depth, "s16le")

    cmd = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-i", file_path,
        "-f", pcm_fmt,
        "-acodec", f"pcm_{pcm_fmt}",
        "-ar", str(sample_rate),
        "-ac", str(channels),
        "pipe:1",
    ]
    log.debug("FFmpeg command: %s", " ".join(cmd))
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


# ── Player ─────────────────────────────────────────────────────────────────────

_PERIOD_SIZE = 4096
_POSITION_PUBLISH_INTERVAL_S = 0.5  # publish signal_path every 500 ms


class Player:
    """
    ALSA exclusive-mode playback engine.

    Parameters
    ----------
    signal_path:
        The :class:`~signal_path.SignalPathManager` instance that tracks the
        current audio chain state.
    queue:
        The :class:`~queue_manager.QueueManager` that provides the next track
        when the current one ends.
    redis_client:
        A synchronous ``redis.Redis`` client used to publish signal-path
        updates.
    """

    def __init__(
        self,
        signal_path: SignalPathManager,
        queue: QueueManager,
        redis_client: Any,
    ) -> None:
        self._sp = signal_path
        self._queue = queue
        self._redis = redis_client

        self._pcm: Any | None = None  # alsaaudio.PCM or StubPCM
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._current_file: str | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def play(self, file_path: str, alsa_device: str | None = None) -> None:
        """
        Start playback of *file_path*.

        If *alsa_device* is provided it overrides the device currently stored
        in the signal path.  Any in-progress playback is stopped first.
        """
        self.stop()

        device = alsa_device or self._sp.signal_path.alsa_device or "default"
        decoder = _decoder_name(file_path)
        suffix = Path(file_path).suffix.lower()
        use_ffmpeg = suffix not in {".flac", ".wav", ".aiff", ".aif", ".ogg", ".opus", ".mp3"} or \
                     decoder == "FFmpeg"

        if use_ffmpeg and decoder == "FFmpeg":
            self._play_via_ffmpeg(file_path, device)
        else:
            self._play_via_soundfile(file_path, device)

    def pause(self) -> None:
        """Pause playback. Safe to call when already paused or stopped."""
        thread = self._thread
        if thread and thread.is_alive():
            self._pause_event.set()
            self._sp.update(status="paused")
            self._sp.publish(self._redis)
            log.info("Playback paused")

    def resume(self) -> None:
        """Resume paused playback. Safe to call when already playing."""
        thread = self._thread
        if thread and thread.is_alive():
            self._pause_event.clear()
            self._sp.update(status="playing")
            self._sp.publish(self._redis)
            log.info("Playback resumed")

    def stop(self) -> None:
        """Stop playback and release the ALSA PCM handle."""
        self._stop_event.set()
        self._pause_event.clear()
        # Capture the thread reference once: self._thread can be reassigned
        # concurrently by a gapless track transition (_handle_track_end runs
        # on the playback thread itself), so re-reading self._thread between
        # the is_alive() check and join() could end up joining the wrong
        # (newly-started) thread instead of the one we just checked.
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=5)
        self._stop_event.clear()
        self._close_pcm()
        self._sp.update(status="stopped", position_ms=0)
        self._sp.publish(self._redis)
        log.info("Playback stopped")

    def seek(self, ms: int) -> None:
        """
        Seek to *ms* milliseconds into the current track.

        This is a best-effort operation: the playback thread must be running
        and the current file must be seekable.  Seeking interrupts the current
        playback loop briefly while the thread acknowledges the new position.
        """
        # Seeking is implemented by stopping the loop, re-opening the file at
        # the new frame position, and restarting.  This keeps the design simple
        # without adding shared-state complexity.
        current = self._sp.signal_path.source_file
        if not current:
            log.warning("seek() called but no file is loaded")
            return
        sample_rate = self._sp.signal_path.source_sample_rate or 44100
        target_frame = int((ms / 1000.0) * sample_rate)
        log.info("Seeking to %d ms (frame %d) in %s", ms, target_frame, current)

        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=5)
        self._stop_event.clear()
        self._close_pcm()

        # Re-open and seek
        device = self._sp.signal_path.alsa_device or "default"
        self._play_via_soundfile(current, device, start_frame=target_frame)

    # ------------------------------------------------------------------
    # Internal: soundfile playback path
    # ------------------------------------------------------------------

    def _play_via_soundfile(
        self,
        file_path: str,
        device: str,
        start_frame: int = 0,
    ) -> None:
        try:
            sound_file = sf.SoundFile(file_path)
        except Exception as exc:
            log.error("Cannot open %s: %s", file_path, exc)
            self._sp.update(status="error")
            self._sp.publish(self._redis)
            return

        sample_rate = sound_file.samplerate
        channels = sound_file.channels
        frames = sound_file.frames
        duration_ms = int((frames / sample_rate) * 1000)

        # Determine bit depth from subtype string e.g. "PCM_16", "PCM_24", "PCM_32"
        subtype = sound_file.subtype  # e.g. "PCM_16"
        bit_depth = self._bit_depth_from_subtype(subtype)

        fmt_upper = Path(file_path).suffix.lstrip(".").upper()
        decoder = _decoder_name(file_path)

        self._sp.update(
            source_file=file_path,
            source_format=fmt_upper,
            source_bit_depth=bit_depth,
            source_sample_rate=sample_rate,
            source_channels=channels,
            decoder=decoder,
            alsa_device=device,
            status="buffering",
            position_ms=0,
            duration_ms=duration_ms,
            bit_perfect=True,
        )
        self._sp.publish(self._redis)

        if start_frame > 0:
            sound_file.seek(start_frame)

        pcm = self._open_pcm(device, bit_depth, channels, sample_rate)
        self._pcm = pcm
        self._current_file = file_path

        self._stop_event.clear()
        self._pause_event.clear()

        self._thread = threading.Thread(
            target=self._playback_loop_sf,
            args=(sound_file, pcm, bit_depth, start_frame),
            daemon=True,
            name="lucid-playback",
        )
        self._thread.start()
        log.info("Started soundfile playback: %s (%d Hz, %d-bit, %dch)",
                 file_path, sample_rate, bit_depth, channels)

    def _playback_loop_sf(
        self,
        sound_file: sf.SoundFile,
        pcm: Any,
        bit_depth: int,
        start_frame: int,
    ) -> None:
        """Main playback loop for soundfile-decoded audio."""
        sample_rate = sound_file.samplerate
        dtype = self._numpy_dtype(bit_depth)
        last_publish = time.monotonic()

        self._sp.update(status="playing")
        self._sp.publish(self._redis)

        try:
            current_frame = start_frame
            while not self._stop_event.is_set():
                # Handle pause
                while self._pause_event.is_set() and not self._stop_event.is_set():
                    time.sleep(0.05)

                if self._stop_event.is_set():
                    break

                data = sound_file.read(_PERIOD_SIZE, dtype=dtype, always_2d=True)
                if data.shape[0] == 0:
                    # End of file — attempt gapless continuation
                    self._handle_track_end()
                    break

                # Convert to bytes for ALSA
                raw = data.tobytes()
                try:
                    pcm.write(raw)
                except Exception as exc:
                    log.error("ALSA write error: %s", exc)
                    self._sp.update(status="error")
                    self._sp.publish(self._redis)
                    break

                current_frame += data.shape[0]

                # Publish position every 500 ms
                now = time.monotonic()
                if now - last_publish >= _POSITION_PUBLISH_INTERVAL_S:
                    position_ms = int((current_frame / sample_rate) * 1000)
                    self._sp.update(position_ms=position_ms)
                    self._sp.publish(self._redis)
                    last_publish = now

        except Exception:
            log.exception("Unexpected error in soundfile playback loop")
            self._sp.update(status="error")
            self._sp.publish(self._redis)
        finally:
            try:
                sound_file.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Internal: FFmpeg playback path
    # ------------------------------------------------------------------

    def _play_via_ffmpeg(self, file_path: str, device: str) -> None:
        """Probe file with soundfile for metadata, then stream via FFmpeg."""
        # Probe metadata
        try:
            info = sf.info(file_path)
            sample_rate = info.samplerate
            channels = info.channels
            frames = info.frames
            duration_ms = int((frames / sample_rate) * 1000) if frames else 0
            bit_depth = self._bit_depth_from_subtype(info.subtype)
        except Exception as exc:
            # soundfile cannot read this format — use sensible defaults. If
            # ffmpeg also can't decode the file, _playback_loop_ffmpeg's read()
            # will return no bytes immediately and silently advance to the
            # next queued track, so log loudly here — this is the only place
            # that failure would otherwise leave a trace.
            log.warning("soundfile could not probe %s (%s) — using default format assumptions", file_path, exc)
            sample_rate = 44100
            channels = 2
            duration_ms = 0
            bit_depth = 16

        fmt_upper = Path(file_path).suffix.lstrip(".").upper()

        self._sp.update(
            source_file=file_path,
            source_format=fmt_upper,
            source_bit_depth=bit_depth,
            source_sample_rate=sample_rate,
            source_channels=channels,
            decoder="FFmpeg",
            alsa_device=device,
            status="buffering",
            position_ms=0,
            duration_ms=duration_ms,
            bit_perfect=True,
        )
        self._sp.publish(self._redis)

        pcm = self._open_pcm(device, bit_depth, channels, sample_rate)
        self._pcm = pcm
        self._current_file = file_path

        self._stop_event.clear()
        self._pause_event.clear()

        self._thread = threading.Thread(
            target=self._playback_loop_ffmpeg,
            args=(file_path, pcm, sample_rate, channels, bit_depth),
            daemon=True,
            name="lucid-playback-ffmpeg",
        )
        self._thread.start()
        log.info("Started FFmpeg playback: %s (%d Hz, %d-bit, %dch)",
                 file_path, sample_rate, bit_depth, channels)

    def _playback_loop_ffmpeg(
        self,
        file_path: str,
        pcm: Any,
        sample_rate: int,
        channels: int,
        bit_depth: int,
    ) -> None:
        """Main playback loop for FFmpeg-decoded audio."""
        proc = _open_via_ffmpeg(file_path, sample_rate, channels, bit_depth)
        assert proc.stdout is not None  # noqa: S101 — guaranteed by Popen(stdout=PIPE)

        bytes_per_sample = bit_depth // 8
        chunk_bytes = _PERIOD_SIZE * channels * bytes_per_sample
        bytes_per_second = sample_rate * channels * bytes_per_sample
        bytes_read_total = 0
        last_publish = time.monotonic()

        self._sp.update(status="playing")
        self._sp.publish(self._redis)

        try:
            while not self._stop_event.is_set():
                while self._pause_event.is_set() and not self._stop_event.is_set():
                    time.sleep(0.05)

                if self._stop_event.is_set():
                    break

                raw = proc.stdout.read(chunk_bytes)
                if not raw:
                    # End of stream
                    self._handle_track_end()
                    break

                try:
                    pcm.write(raw)
                except Exception as exc:
                    log.error("ALSA write error (FFmpeg path): %s", exc)
                    self._sp.update(status="error")
                    self._sp.publish(self._redis)
                    break

                bytes_read_total += len(raw)

                now = time.monotonic()
                if now - last_publish >= _POSITION_PUBLISH_INTERVAL_S:
                    position_ms = int((bytes_read_total / bytes_per_second) * 1000)
                    self._sp.update(position_ms=position_ms)
                    self._sp.publish(self._redis)
                    last_publish = now

        except Exception:
            log.exception("Unexpected error in FFmpeg playback loop")
            self._sp.update(status="error")
            self._sp.publish(self._redis)
        finally:
            proc.stdout.close()
            proc.wait()

    # ------------------------------------------------------------------
    # Gapless continuation
    # ------------------------------------------------------------------

    def _handle_track_end(self) -> None:
        """Called when the current track finishes; attempts gapless next track."""
        log.debug("Track ended — checking queue for next track")
        next_path = self._queue.next()
        if next_path:
            log.info("Gapless: advancing to %s", next_path)
            device = self._sp.signal_path.alsa_device or "default"
            # Re-use the open PCM if possible (same format); simplest approach
            # is to close and reopen — gapless gap is imperceptible for ALSA.
            self._close_pcm()
            self._play_via_soundfile(next_path, device)
        else:
            log.info("Queue exhausted — playback stopped")
            self._sp.update(status="stopped", position_ms=0)
            self._sp.publish(self._redis)

    # ------------------------------------------------------------------
    # ALSA helpers
    # ------------------------------------------------------------------

    def _open_pcm(
        self,
        device: str,
        bit_depth: int,
        channels: int,
        sample_rate: int,
    ) -> Any:
        """Open an ALSA PCM device or return a :class:`StubPCM`."""
        if _ALSA_AVAILABLE:
            try:
                pcm = alsaaudio.PCM(
                    alsaaudio.PCM_PLAYBACK,
                    alsaaudio.PCM_NORMAL,
                    device=device,
                )
                pcm.setformat(_alsa_format_for_depth(bit_depth))
                pcm.setchannels(channels)
                pcm.setrate(sample_rate)
                pcm.setperiodsize(_PERIOD_SIZE)
                log.info("Opened ALSA device %r (%d Hz, %d-bit, %dch)",
                         device, sample_rate, bit_depth, channels)
                return pcm
            except Exception as exc:
                log.error("Failed to open ALSA device %r: %s — using StubPCM", device, exc)
                return StubPCM()
        return StubPCM()

    def _close_pcm(self) -> None:
        if self._pcm is not None:
            try:
                self._pcm.close()
            except Exception:
                pass
            self._pcm = None

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @staticmethod
    def _bit_depth_from_subtype(subtype: str) -> int:
        """
        Derive bit depth from a soundfile subtype string.

        Examples: "PCM_16" → 16, "PCM_24" → 24, "PCM_32" → 32.
        Defaults to 16 for unknown subtypes.
        """
        subtype_upper = (subtype or "").upper()
        for depth in (32, 24, 16):
            if str(depth) in subtype_upper:
                return depth
        return 16

    @staticmethod
    def _numpy_dtype(bit_depth: int) -> str:
        return {16: "int16", 24: "int32", 32: "int32"}.get(bit_depth, "int16")
