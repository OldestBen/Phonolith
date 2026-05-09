import asyncio, json, os
from datetime import datetime, timezone
from loguru import logger
import nats
from zeroconf import ServiceBrowser, ServiceStateChange, Zeroconf
from zeroconf.asyncio import AsyncServiceInfo

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")

# In-memory registry of discovered AirPlay endpoints
# key: service_name, value: endpoint dict
discovered_endpoints: dict[str, dict] = {}

# NATS connection (set after connect)
nc_global = None


def on_service_state_change(zeroconf: Zeroconf, service_type: str, name: str, state_change: ServiceStateChange):
    if state_change is ServiceStateChange.Added:
        asyncio.get_event_loop().create_task(on_service_added(zeroconf, service_type, name))
    elif state_change is ServiceStateChange.Removed:
        if name in discovered_endpoints:
            logger.info(f"AirPlay endpoint removed: {name}")
            del discovered_endpoints[name]
            asyncio.get_event_loop().create_task(publish_endpoints())


async def on_service_added(zeroconf: Zeroconf, service_type: str, name: str):
    info = AsyncServiceInfo(service_type, name)
    await info.async_request(zeroconf, 3000)
    if not info.addresses:
        return

    import socket
    ip = socket.inet_ntoa(info.addresses[0])
    port = info.port
    properties = {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v
                  for k, v in (info.properties or {}).items()}

    endpoint_id = properties.get("deviceid", name)
    endpoint = {
        "endpoint_id": endpoint_id,
        "name": name,
        "service_type": service_type,
        "ip": ip,
        "port": port,
        "model": properties.get("am", "unknown"),
        "protocol": "airplay2" if "_airplay._tcp" in service_type else "raop",
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        "properties": properties,
    }
    discovered_endpoints[name] = endpoint
    logger.info(f"Discovered AirPlay endpoint: {endpoint['name']} ({ip}:{port})")
    await publish_endpoints()


async def publish_endpoints():
    if nc_global is None:
        return
    payload = list(discovered_endpoints.values())
    await nc_global.publish("phonolith.flux.endpoints", json.dumps(payload).encode())
    logger.debug(f"Published {len(payload)} endpoints to phonolith.flux.endpoints")


async def handle_route_command(msg):
    try:
        payload = json.loads(msg.data.decode())
        endpoint_id = payload.get("endpoint_id")
        action = payload.get("action")

        endpoint = next((e for e in discovered_endpoints.values() if e["endpoint_id"] == endpoint_id), None)
        if endpoint is None:
            logger.warning(f"Route command for unknown endpoint: {endpoint_id}")
            return

        logger.info(f"Route command: action={action} endpoint={endpoint_id} ip={endpoint['ip']}:{endpoint['port']}")

        # Emit a routed event for Lucid/other services to act on
        event = {
            "endpoint_id": endpoint_id,
            "action": action,
            "ip": endpoint["ip"],
            "port": endpoint["port"],
            "protocol": endpoint["protocol"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await nc_global.publish("phonolith.playback.routed", json.dumps(event).encode())
    except Exception as e:
        logger.exception(f"Error handling route command: {e}")


async def main():
    global nc_global
    logger.info(f"Flux starting, connecting to NATS at {NATS_URL}")
    nc_global = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    await nc_global.subscribe("phonolith.flux.route", cb=lambda msg: asyncio.create_task(handle_route_command(msg)))
    logger.info("Subscribed to phonolith.flux.route")

    zeroconf = Zeroconf()
    services = ["_airplay._tcp.local.", "_raop._tcp.local."]
    browser = ServiceBrowser(zeroconf, services, handlers=[on_service_state_change])
    logger.info(f"Browsing for AirPlay services: {services}")

    try:
        while True:
            await asyncio.sleep(30)
            logger.info(f"Flux alive — {len(discovered_endpoints)} endpoints known")
            await publish_endpoints()
    finally:
        zeroconf.close()
        await nc_global.drain()


if __name__ == "__main__":
    asyncio.run(main())
