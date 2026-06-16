"""
polyphony_discovery.py — LAN discovery for the Polyphony peer network.

"Public discovery" in Polyphony means LAN/mDNS discoverability, not a
public internet directory: reusing the zeroconf machinery Flux already
depends on for AirPlay lets a Phonolith instance broadcast its bare
existence (peer id + display name only — never library contents) to other
Phonolith instances on the same network, and browse for theirs. Pairing
still requires a human-entered one-time code from the target's admin, so
discovery only ever saves typing a hostname; it never grants trust.

A real public (WAN) discovery service would require a hosted rendezvous
server and a much larger trust/abuse model — out of scope here.
"""

from __future__ import annotations

import logging
import socket
import threading
from typing import Any

from zeroconf import ServiceInfo, ServiceBrowser, ServiceListener, Zeroconf

log = logging.getLogger("lucid.polyphony_discovery")

_SERVICE_TYPE = "_polyphony._tcp.local."


class _PolyphonyListener(ServiceListener):
    def __init__(self, registry: dict[str, dict[str, Any]]) -> None:
        self._registry = registry

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if info is None:
            return
        props = info.properties or {}
        peer_id = (props.get(b"peer_id") or b"").decode("utf-8", errors="replace")
        peer_name = (props.get(b"name") or b"").decode("utf-8", errors="replace")
        host = ".".join(str(b) for b in info.addresses[0]) if info.addresses else "unknown"
        port = (props.get(b"port") or str(info.port).encode()).decode("utf-8", errors="replace")
        if not peer_id:
            return
        self._registry[peer_id] = {"peerId": peer_id, "name": peer_name or name, "host": host, "port": port}
        log.info("Polyphony peer discovered: %s (%s) at %s", peer_name, peer_id, host)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:  # noqa: ARG002
        # Entries are keyed by peer_id, which we can't recover from `name`
        # alone; stale entries are harmless and get overwritten on rediscovery.
        pass

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.add_service(zc, type_, name)


class PolyphonyDiscovery:
    """Browses for other Polyphony instances on the LAN and, optionally, announces this one."""

    def __init__(self) -> None:
        self.discovered: dict[str, dict[str, Any]] = {}
        self._zeroconf: Zeroconf | None = None
        self._browser: ServiceBrowser | None = None
        self._own_info: ServiceInfo | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._zeroconf is not None:
            return
        try:
            self._zeroconf = Zeroconf()
            listener = _PolyphonyListener(self.discovered)
            self._browser = ServiceBrowser(self._zeroconf, _SERVICE_TYPE, listener)
            log.info("PolyphonyDiscovery started — browsing for %s", _SERVICE_TYPE)
        except Exception:
            log.exception("Failed to start PolyphonyDiscovery / Zeroconf browser")

    def stop(self) -> None:
        with self._lock:
            self._unannounce_locked()
        if self._zeroconf is not None:
            try:
                self._zeroconf.close()
            except Exception:
                log.exception("Error stopping PolyphonyDiscovery")
            finally:
                self._zeroconf = None
                self._browser = None

    def list_discovered(self) -> list[dict[str, Any]]:
        return list(self.discovered.values())

    def announce(self, peer_id: str, name: str, port: int) -> None:
        """Start (or update) broadcasting this instance's presence on the LAN."""
        if self._zeroconf is None:
            return
        with self._lock:
            self._unannounce_locked()
            try:
                local_ip = socket.gethostbyname(socket.gethostname())
                addr_bytes = socket.inet_aton(local_ip)
            except Exception:
                addr_bytes = socket.inet_aton("127.0.0.1")

            info = ServiceInfo(
                _SERVICE_TYPE,
                f"{peer_id}.{_SERVICE_TYPE}",
                addresses=[addr_bytes],
                port=port,
                properties={"peer_id": peer_id, "name": name, "port": str(port)},
            )
            try:
                self._zeroconf.register_service(info)
                self._own_info = info
                log.info("Announcing Polyphony presence: %s (%s)", name, peer_id)
            except Exception:
                log.exception("Failed to announce Polyphony presence")

    def unannounce(self) -> None:
        with self._lock:
            self._unannounce_locked()

    def _unannounce_locked(self) -> None:
        if self._own_info is not None and self._zeroconf is not None:
            try:
                self._zeroconf.unregister_service(self._own_info)
            except Exception:
                pass
            self._own_info = None
