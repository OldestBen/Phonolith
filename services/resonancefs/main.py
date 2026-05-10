import asyncio, json, os, subprocess
from datetime import datetime, timezone
from pathlib import Path
from loguru import logger
import nats

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")

AUDIO_EXTENSIONS = {
    ".flac", ".mp3", ".aac", ".m4a", ".ogg", ".opus", ".wav",
    ".aiff", ".aif", ".dsf", ".dff", ".wv", ".ape", ".mpc", ".wma",
}

# Track active mounts: mount_point -> mount info dict
active_mounts: dict[str, dict] = {}


async def _task(nc, level: str, message: str) -> None:
    try:
        await nc.publish(
            "phonolith.tasks.resonancefs",
            json.dumps({"service": "resonancefs", "level": level, "message": message,
                        "ts": datetime.now(timezone.utc).isoformat()}).encode(),
        )
    except Exception:
        pass


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


async def scan_mount(nc, js, mount_point: str, share_label: str) -> None:
    """Walk a mounted share, emit phonolith.fs.created events for every audio file."""
    found = 0
    errors = 0
    await _task(nc, "info", f"Scanning {share_label}…")
    logger.info(f"Starting scan of {mount_point}")

    for root, _dirs, files in os.walk(mount_point):
        for fname in files:
            if Path(fname).suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            full_path = os.path.join(root, fname)
            found += 1
            event = {
                "event_type": "created",
                "path": full_path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            try:
                await js.publish("phonolith.fs.created", json.dumps(event).encode())
            except Exception as e:
                logger.error(f"Failed to publish fs event for {full_path}: {e}")
                errors += 1

            if found % 200 == 0:
                await _task(nc, "info", f"Scanning {share_label}: {found} tracks found so far…")
                await asyncio.sleep(0)  # yield to event loop

    level = "success" if found > 0 else "warning"
    suffix = f" ({errors} publish errors)" if errors else ""
    await _task(nc, level, f"Scan complete — {found} audio file(s) found in {share_label}{suffix}")
    logger.info(f"Scan complete: {found} files in {mount_point}")


async def handle_mount_request(msg, nc, js):
    try:
        payload = json.loads(msg.data.decode())
        protocol = payload.get("protocol", "smb").lower()
        host = payload["host"]
        share = payload["share"]
        mount_point = payload["mount_point"]
        username = payload.get("username", "")
        password = payload.get("password", "")
        scan_after = payload.get("scan_after_mount", True)

        success = False
        share_label = f"{host}/{share}"

        if protocol == "smb":
            success = mount_smb(host, share, username, password, mount_point)
        elif protocol == "nfs":
            success = mount_nfs(host, share, mount_point)
        else:
            logger.warning(f"Unsupported protocol: {protocol}")
            await _task(nc, "error", f"Unsupported protocol: {protocol}")

        if success:
            active_mounts[mount_point] = {
                "protocol": protocol, "host": host, "share": share,
                "mounted_at": datetime.now(timezone.utc).isoformat(),
            }
            await _task(nc, "success", f"Mounted {protocol.upper()} {share_label} — authentication OK")
            if scan_after:
                asyncio.create_task(scan_mount(nc, js, mount_point, share_label))
        else:
            await _task(nc, "error", f"Failed to mount {protocol.upper()} {share_label} — check credentials / host reachability")

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
        await _task(nc, "error", f"Internal error processing mount request: {e}")


async def check_mounts_loop(nc):
    """Periodically verify all mounts are alive and publish health events."""
    while True:
        await asyncio.sleep(60)
        health = []
        for mount_point, info in list(active_mounts.items()):
            alive = is_mount_alive(mount_point)
            if not alive:
                label = f"{info['host']}/{info['share']}"
                logger.warning(f"Mount {mount_point} is no longer alive")
                await _task(nc, "warning", f"Network share lost: {label} — will retry on next sync")
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

    js = nc.jetstream()
    # Ensure the FS stream exists (tremor also creates it, but we may start first).
    try:
        await js.add_stream(name="PHONOLITH_FS", subjects=["phonolith.fs.>"])
    except Exception:
        pass  # stream already exists or tremor will create it

    async def _cb_mount(msg):
        await handle_mount_request(msg, nc, js)

    await nc.subscribe("phonolith.resonancefs.mount", cb=_cb_mount)
    logger.info("Subscribed to phonolith.resonancefs.mount")

    await check_mounts_loop(nc)


if __name__ == "__main__":
    asyncio.run(main())
