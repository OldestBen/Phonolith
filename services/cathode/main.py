import asyncio, json, os
from datetime import datetime, timezone
from loguru import logger
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")
ENDPOINTS_FILE = os.path.join(DATA_DIR, "cathode_endpoints.json")

# In-memory session tracking: endpoint_id -> {"start_ts": float, "track_hash": str}
active_sessions: dict[str, dict] = {}


def load_endpoints() -> dict:
    """Load endpoint stats from disk."""
    if os.path.exists(ENDPOINTS_FILE):
        try:
            with open(ENDPOINTS_FILE) as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load endpoints file: {e}")
    return {}


def save_endpoints(data: dict) -> None:
    """Persist endpoint stats to disk."""
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = ENDPOINTS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, ENDPOINTS_FILE)
    logger.debug(f"Saved endpoint stats to {ENDPOINTS_FILE}")


async def handle_playback_started(msg, endpoint_stats: dict) -> None:
    try:
        payload = json.loads(msg.data.decode())
        endpoint_id = payload.get("endpoint_id")
        track_hash = payload.get("hash", "unknown")
        if not endpoint_id:
            logger.warning("playback.started event missing endpoint_id")
            return

        active_sessions[endpoint_id] = {
            "start_ts": datetime.now(timezone.utc).timestamp(),
            "track_hash": track_hash,
        }
        logger.info(f"Playback started on endpoint {endpoint_id}, track {track_hash}")

        # Ensure endpoint exists in stats
        if endpoint_id not in endpoint_stats:
            endpoint_stats[endpoint_id] = {
                "total_play_hours": 0.0,
                "total_play_sessions": 0,
                "first_seen": datetime.now(timezone.utc).isoformat(),
                "last_seen": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        logger.exception(f"Error handling playback.started: {e}")


async def handle_playback_stopped(msg, endpoint_stats: dict) -> None:
    try:
        payload = json.loads(msg.data.decode())
        endpoint_id = payload.get("endpoint_id")
        if not endpoint_id:
            logger.warning("playback.stopped event missing endpoint_id")
            return

        session = active_sessions.pop(endpoint_id, None)
        if session is None:
            logger.warning(f"No active session found for endpoint {endpoint_id}")
            return

        elapsed_seconds = datetime.now(timezone.utc).timestamp() - session["start_ts"]
        elapsed_hours = elapsed_seconds / 3600.0

        if endpoint_id not in endpoint_stats:
            endpoint_stats[endpoint_id] = {
                "total_play_hours": 0.0,
                "total_play_sessions": 0,
                "first_seen": datetime.now(timezone.utc).isoformat(),
                "last_seen": datetime.now(timezone.utc).isoformat(),
            }

        endpoint_stats[endpoint_id]["total_play_hours"] += elapsed_hours
        endpoint_stats[endpoint_id]["total_play_sessions"] += 1
        endpoint_stats[endpoint_id]["last_seen"] = datetime.now(timezone.utc).isoformat()

        logger.info(
            f"Playback stopped on endpoint {endpoint_id}: "
            f"+{elapsed_hours:.4f}h (total: {endpoint_stats[endpoint_id]['total_play_hours']:.2f}h)"
        )
        save_endpoints(endpoint_stats)
    except Exception as e:
        logger.exception(f"Error handling playback.stopped: {e}")


async def main():
    logger.info(f"Cathode starting, connecting to NATS at {NATS_URL}")
    endpoint_stats = load_endpoints()
    logger.info(f"Loaded stats for {len(endpoint_stats)} endpoints")

    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    async def _cb_started(msg):
        await handle_playback_started(msg, endpoint_stats)

    async def _cb_stopped(msg):
        await handle_playback_stopped(msg, endpoint_stats)

    await nc.subscribe("phonolith.playback.started", cb=_cb_started)
    await nc.subscribe("phonolith.playback.stopped", cb=_cb_stopped)
    logger.info("Subscribed to phonolith.playback.started and phonolith.playback.stopped")

    # Keep alive
    while True:
        await asyncio.sleep(300)
        logger.info(f"Cathode alive — tracking {len(active_sessions)} active sessions, {len(endpoint_stats)} endpoints total")


if __name__ == "__main__":
    asyncio.run(main())
