"""
flux.py — AirPlay endpoint discovery and routing for Lucid.

Uses zeroconf to browse ``_raop._tcp.local.`` (Remote Audio Output Protocol)
service announcements, maintaining a live registry of discovered AirPlay
receivers.  Full RTSP/ALAC streaming is future work; this module provides
discovery and a placeholder routing method.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

log = logging.getLogger("lucid.flux")

_RAOP_SERVICE_TYPE = "_raop._tcp.local."


class _RaopListener(ServiceListener):
    """
    Zeroconf service listener that populates :attr:`FluxManager.discovered`
    as AirPlay (RAOP) services come and go.
    """

    def __init__(self, registry: dict[str, dict[str, Any]]) -> None:
        self._registry = registry

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if info is None:
            return
        # The RAOP service name is typically "<MAC>@<Device Name>._raop._tcp.local."
        friendly_name = name.split("@", 1)[-1].split("._")[0] if "@" in name else name.split("._")[0]
        host = (
            ".".join(str(b) for b in info.addresses[0])
            if info.addresses
            else "unknown"
        )
        port = info.port
        model = (info.properties.get(b"am", b"") or b"").decode("utf-8", errors="replace")

        entry = {"name": friendly_name, "host": host, "port": port, "model": model}
        self._registry[friendly_name] = entry
        log.info("AirPlay endpoint discovered: %s (%s:%d, model=%r)", friendly_name, host, port, model)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:  # noqa: ARG002
        friendly_name = name.split("@", 1)[-1].split("._")[0] if "@" in name else name.split("._")[0]
        removed = self._registry.pop(friendly_name, None)
        if removed:
            log.info("AirPlay endpoint lost: %s", friendly_name)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        # Re-use add_service to refresh the entry.
        self.add_service(zc, type_, name)


class FluxManager:
    """
    Discovers AirPlay receivers on the local network via mDNS/Zeroconf.

    Usage::

        flux = FluxManager()
        flux.start()
        ...
        endpoints = flux.list_endpoints()
        ...
        flux.stop()
    """

    def __init__(self) -> None:
        self.discovered: dict[str, dict[str, Any]] = {}
        self._zeroconf: Zeroconf | None = None
        self._browser: ServiceBrowser | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start mDNS browsing for RAOP/AirPlay services in a background thread."""
        if self._zeroconf is not None:
            log.debug("FluxManager already started")
            return
        try:
            self._zeroconf = Zeroconf()
            listener = _RaopListener(self.discovered)
            self._browser = ServiceBrowser(self._zeroconf, _RAOP_SERVICE_TYPE, listener)
            log.info("FluxManager started — browsing for %s", _RAOP_SERVICE_TYPE)
        except Exception:
            log.exception("Failed to start FluxManager / Zeroconf browser")

    def stop(self) -> None:
        """Stop the mDNS browser and release Zeroconf resources."""
        if self._zeroconf is not None:
            try:
                self._zeroconf.close()
                log.info("FluxManager stopped")
            except Exception:
                log.exception("Error stopping FluxManager")
            finally:
                self._zeroconf = None
                self._browser = None

    # ------------------------------------------------------------------
    # Discovery API
    # ------------------------------------------------------------------

    def list_endpoints(self) -> list[dict[str, Any]]:
        """
        Return all currently discovered AirPlay endpoints.

        Each entry is a dict with keys ``name``, ``host``, ``port``,
        and ``model``.
        """
        return list(self.discovered.values())

    def endpoint_info(self, name: str) -> dict[str, Any] | None:
        """Return the info dict for the named endpoint, or ``None`` if not found."""
        return self.discovered.get(name)

    # ------------------------------------------------------------------
    # Routing (placeholder)
    # ------------------------------------------------------------------

    def stream_to(self, endpoint_name: str, file_path: str) -> None:
        """
        Route *file_path* to the named AirPlay endpoint.

        .. note::
            Full RTSP/ALAC AirPlay streaming is not yet implemented.
            This method logs a notice and returns immediately.  Direct ALSA
            output via :class:`~player.Player` is the recommended path for
            bit-perfect playback.
        """
        log.info(
            "stream_to(%r, %r): AirPlay streaming not yet implemented — "
            "use Lucid for direct ALSA output",
            endpoint_name,
            file_path,
        )
