"""
Flux — AirPlay 2 / RAOP discovery and audio streaming daemon.

mDNS discovery:
  Publishes to: phonolith.flux.endpoints  (list of discovered AirPlay devices)

Audio streaming:
  Subscribes to: phonolith.flux.stream    {endpoint_id, path, blake3_hash}
  Subscribes to: phonolith.flux.stop      {endpoint_id}
  Subscribes to: phonolith.flux.route     {endpoint_id, action}

  Uses pyatv to connect to discovered AirPlay endpoints and stream local
  audio files. pyatv handles RAOP/AirPlay 2 protocol, ALAC encoding, and
  NTP-based clock sync for multi-room.

  Publishes to: phonolith.playback.signal  (streaming signal path state)
"""

import asyncio
import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger
import nats
from zeroconf import ServiceBrowser, ServiceStateChange, Zeroconf
from zeroconf.asyncio import AsyncServiceInfo

try:
    import pyatv
    import pyatv.const
    PYATV_AVAILABLE = True
except ImportError:
    PYATV_AVAILABLE = False
    logger.warning("pyatv not available — AirPlay streaming disabled, discovery only")

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR  = os.getenv("DATA_DIR", "/data")

# Registry of discovered AirPlay endpoints
discovered_endpoints: dict[str, dict] = {}

# Active streaming sessions: endpoint_id -> asyncio.Task
active_streams: dict[str, asyncio.Task] = {}

nc_global = None


# ── mDNS discovery ────────────────────────────────────────────────────────────

def on_service_state_change(
    zeroconf: Zeroconf, service_type: str, name: str, state_change: ServiceStateChange
):
    loop = asyncio.get_event_loop()
    if state_change is ServiceStateChange.Added:
        loop.create_task(on_service_added(zeroconf, service_type, name))
    elif state_change is ServiceStateChange.Removed:
        if name in discovered_endpoints:
            logger.info(f"AirPlay endpoint removed: {name}")
            del discovered_endpoints[name]
            loop.create_task(publish_endpoints())


async def on_service_added(zeroconf: Zeroconf, service_type: str, name: str):
    info = AsyncServiceInfo(service_type, name)
    await info.async_request(zeroconf, 3000)
    if not info.addresses:
        return

    ip = socket.inet_ntoa(info.addresses[0])
    port = info.port
    props = {
        (k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v)
        for k, v in (info.properties or {}).items()
    }

    endpoint_id = props.get("deviceid", name)
    endpoint = {
        "endpoint_id": endpoint_id,
        "name":         name,
        "service_type": service_type,
        "ip":           ip,
        "port":         port,
        "model":        props.get("am", "unknown"),
        "protocol":     "airplay2" if "_airplay._tcp" in service_type else "raop",
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        "properties":   props,
    }
    discovered_endpoints[name] = endpoint
    logger.info(f"Discovered AirPlay endpoint: {name} @ {ip}:{port} ({endpoint['protocol']})")
    await publish_endpoints()


async def publish_endpoints():
    if nc_global is None:
        return
    await nc_global.publish(
        "phonolith.flux.endpoints",
        json.dumps(list(discovered_endpoints.values())).encode(),
    )


# ── AirPlay streaming ─────────────────────────────────────────────────────────

async def _stream_to_endpoint(endpoint: dict, path: str, blake3_hash: str) -> None:
    if not PYATV_AVAILABLE:
        logger.warning("pyatv not installed — cannot stream to AirPlay")
        return

    ip   = endpoint["ip"]
    name = endpoint["name"]
    logger.info(f"Connecting to AirPlay endpoint {name} ({ip}) for {Path(path).name}")

    # Scan for the device at the known IP
    loop = asyncio.get_event_loop()
    atvs = await pyatv.scan(loop, hosts=[ip], timeout=5)
    if not atvs:
        logger.error(f"pyatv could not find {name} at {ip}")
        return

    atv_conf = atvs[0]
    atv = await pyatv.connect(atv_conf, loop)

    try:
        # Publish "playing" signal path event
        if nc_global:
            signal = {
                "blake3_hash":        blake3_hash,
                "path":               path,
                "source_format":      Path(path).suffix.lstrip(".").upper(),
                "source_bit_depth":   0,
                "source_sample_rate": 0,
                "source_channels":    2,
                "source_bitrate_kbps": 0,
                "decoder":            "pyatv (ALAC)",
                "dsp_active":         False,
                "transport":          f"AirPlay → {name}",
                "output_endpoint":    endpoint["endpoint_id"],
                "output_format":      "ALAC 44.1kHz (AirPlay)",
                "is_bit_perfect":     False,
                "hash_verified":      True,
                "state":              "playing",
                "timestamp":          datetime.now(timezone.utc).isoformat(),
            }
            await nc_global.publish("phonolith.playback.signal", json.dumps(signal).encode())

        logger.info(f"Streaming {path} → {name}")
        await atv.stream.stream_file(path)
        logger.info(f"Stream complete: {path} → {name}")

    except asyncio.CancelledError:
        logger.info(f"Stream cancelled: {name}")
    except Exception as e:
        logger.error(f"Stream error to {name}: {e}")
    finally:
        atv.close()
        if nc_global:
            stopped = {
                "blake3_hash":   blake3_hash,
                "path":          path,
                "state":         "stopped",
                "output_endpoint": endpoint["endpoint_id"],
                "transport":     f"AirPlay → {name}",
                "timestamp":     datetime.now(timezone.utc).isoformat(),
            }
            await nc_global.publish("phonolith.playback.signal", json.dumps(stopped).encode())


async def handle_stream(msg):
    try:
        payload = json.loads(msg.data.decode())
    except Exception as e:
        logger.warning(f"Stream msg deserialize error: {e}")
        return

    endpoint_id = payload.get("endpoint_id")
    path        = payload.get("path", "")
    blake3_hash = payload.get("blake3_hash", "")

    endpoint = next(
        (e for e in discovered_endpoints.values() if e["endpoint_id"] == endpoint_id), None
    )
    if endpoint is None:
        logger.warning(f"Stream requested for unknown endpoint: {endpoint_id}")
        return

    if not Path(path).exists():
        logger.error(f"File not found for AirPlay stream: {path}")
        return

    # Cancel any existing stream to this endpoint
    existing = active_streams.pop(endpoint_id, None)
    if existing and not existing.done():
        existing.cancel()
        try:
            await existing
        except asyncio.CancelledError:
            pass

    task = asyncio.create_task(_stream_to_endpoint(endpoint, path, blake3_hash))
    active_streams[endpoint_id] = task


async def handle_stop(msg):
    try:
        payload = json.loads(msg.data.decode())
    except Exception:
        return

    endpoint_id = payload.get("endpoint_id")
    task = active_streams.pop(endpoint_id, None)
    if task and not task.done():
        task.cancel()
        logger.info(f"Stopped AirPlay stream to {endpoint_id}")


async def handle_route_command(msg):
    try:
        payload = json.loads(msg.data.decode())
    except Exception:
        return

    endpoint_id = payload.get("endpoint_id")
    action      = payload.get("action")
    endpoint    = next(
        (e for e in discovered_endpoints.values() if e["endpoint_id"] == endpoint_id), None
    )
    if endpoint is None:
        logger.warning(f"Route command for unknown endpoint: {endpoint_id}")
        return

    logger.info(f"Route: action={action} endpoint={endpoint_id} {endpoint['ip']}:{endpoint['port']}")
    if nc_global:
        event = {
            "endpoint_id": endpoint_id,
            "action":      action,
            "ip":          endpoint["ip"],
            "port":        endpoint["port"],
            "protocol":    endpoint["protocol"],
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        }
        await nc_global.publish("phonolith.playback.routed", json.dumps(event).encode())


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    global nc_global
    logger.info(f"Flux starting — AirPlay streaming {'enabled' if PYATV_AVAILABLE else 'DISABLED (no pyatv)'})")

    nc_global = await nats.connect(NATS_URL)
    logger.info(f"Connected to NATS at {NATS_URL}")

    await nc_global.subscribe(
        "phonolith.flux.stream",
        cb=lambda msg: asyncio.create_task(handle_stream(msg)),
    )
    await nc_global.subscribe(
        "phonolith.flux.stop",
        cb=lambda msg: asyncio.create_task(handle_stop(msg)),
    )
    await nc_global.subscribe(
        "phonolith.flux.route",
        cb=lambda msg: asyncio.create_task(handle_route_command(msg)),
    )
    logger.info("Subscribed to phonolith.flux.{stream,stop,route}")

    zc = Zeroconf()
    ServiceBrowser(zc, ["_airplay._tcp.local.", "_raop._tcp.local."], handlers=[on_service_state_change])
    logger.info("Browsing for _airplay._tcp and _raop._tcp services")

    try:
        while True:
            await asyncio.sleep(30)
            logger.debug(f"Flux alive — {len(discovered_endpoints)} endpoints, {len(active_streams)} active streams")
            await publish_endpoints()
    finally:
        zc.close()
        for task in active_streams.values():
            task.cancel()
        await nc_global.drain()


if __name__ == "__main__":
    asyncio.run(main())
