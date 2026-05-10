import asyncio, json, os, subprocess
from datetime import datetime, timezone
from loguru import logger
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")

# Track active mounts: mount_point -> mount info dict
active_mounts: dict[str, dict] = {}


def mount_smb(host: str, share: str, username: str, password: str, mount_point: str) -> bool:
    """Mount an SMB share using mount.cifs via subprocess."""
    os.makedirs(mount_point, exist_ok=True)
    cmd = [
        "mount", "-t", "cifs",
        f"//{host}/{share}",
        mount_point,
        "-o", f"username={username},password={password},vers=3.0",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"SMB mount failed for {host}/{share}: {result.stderr.strip()}")
        return False
    logger.info(f"Mounted SMB //{host}/{share} at {mount_point}")
    return True


def mount_nfs(host: str, share: str, mount_point: str) -> bool:
    """Mount an NFS share via subprocess."""
    os.makedirs(mount_point, exist_ok=True)
    cmd = ["mount", "-t", "nfs", f"{host}:{share}", mount_point]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"NFS mount failed for {host}:{share}: {result.stderr.strip()}")
        return False
    logger.info(f"Mounted NFS {host}:{share} at {mount_point}")
    return True


def is_mount_alive(mount_point: str) -> bool:
    """Check if the mount point is still accessible."""
    try:
        os.listdir(mount_point)
        return True
    except OSError:
        return False


async def handle_mount_request(msg, nc):
    try:
        payload = json.loads(msg.data.decode())
        protocol = payload.get("protocol", "smb").lower()
        host = payload["host"]
        share = payload["share"]
        mount_point = payload["mount_point"]
        username = payload.get("username", "")
        password = payload.get("password", "")

        success = False
        if protocol == "smb":
            success = mount_smb(host, share, username, password, mount_point)
        elif protocol == "nfs":
            success = mount_nfs(host, share, mount_point)
        else:
            logger.warning(f"Unsupported protocol: {protocol}")

        if success:
            active_mounts[mount_point] = {
                "protocol": protocol, "host": host, "share": share,
                "mounted_at": datetime.now(timezone.utc).isoformat(),
            }

        status = {
            "mount_point": mount_point,
            "status": "mounted" if success else "failed",
            "protocol": protocol,
            "host": host,
            "share": share,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await nc.publish("phonolith.resonancefs.status", json.dumps(status).encode())
    except Exception as e:
        logger.exception(f"Error handling mount request: {e}")


async def check_mounts_loop(nc):
    """Periodically verify all mounts are alive and publish health events."""
    while True:
        await asyncio.sleep(60)
        health = []
        for mount_point, info in list(active_mounts.items()):
            alive = is_mount_alive(mount_point)
            if not alive:
                logger.warning(f"Mount {mount_point} is no longer alive")
            health.append({"mount_point": mount_point, "alive": alive, **info})
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "mounts": health,
            "total": len(health),
            "alive": sum(1 for h in health if h["alive"]),
        }
        await nc.publish("phonolith.resonancefs.status", json.dumps(event).encode())
        logger.info(f"Mount health: {event['alive']}/{event['total']} alive")


async def main():
    logger.info(f"ResonanceFS starting, connecting to NATS at {NATS_URL}")
    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    async def _cb_mount(msg):
        await handle_mount_request(msg, nc)

    await nc.subscribe("phonolith.resonancefs.mount", cb=_cb_mount)
    logger.info("Subscribed to phonolith.resonancefs.mount")

    await check_mounts_loop(nc)


if __name__ == "__main__":
    asyncio.run(main())
