"""
S.M.A.R.T. health monitoring service.

Polls drives via `smartctl --json` on a configurable interval.
Publishes per-drive health reports to phonolith.health.smart.
Triggers an alert to phonolith.health.alert when reallocated sectors
or pending sectors are detected.

Requires: smartmontools (smartctl in $PATH), privileged Docker container or CAP_SYS_RAWIO.
Set DEVICES=/dev/sda,/dev/sdb or leave empty for auto-detect via smartctl --scan.
"""

import asyncio, json, os, subprocess
from datetime import datetime, timezone
from loguru import logger
import nats

NATS_URL          = os.getenv("NATS_URL",          "nats://localhost:4222")
POLL_INTERVAL     = int(os.getenv("SMART_POLL_INTERVAL_SECS", "3600"))   # 1 hour default
DEVICES_ENV       = os.getenv("DEVICES", "")    # comma-separated, or empty for auto-detect

# SMART attribute IDs that signal imminent failure
CRITICAL_ATTRS = {
    5:   "Reallocated Sectors",
    187: "Reported Uncorrectable Errors",
    197: "Current Pending Sectors",
    198: "Offline Uncorrectable Sectors",
}


def auto_detect_devices() -> list[str]:
    """Use `smartctl --scan` to find available drives."""
    try:
        result = subprocess.run(
            ["smartctl", "--scan", "--json"],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(result.stdout)
        devices = [d.get("name") for d in data.get("devices", []) if d.get("name")]
        logger.info(f"Auto-detected {len(devices)} devices: {devices}")
        return devices
    except Exception as e:
        logger.warning(f"smartctl --scan failed: {e}")
        return []


def read_smart(device: str) -> dict | None:
    """Run smartctl -a --json on a device and parse the output."""
    try:
        result = subprocess.run(
            ["smartctl", "-a", "--json", device],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        return data
    except json.JSONDecodeError:
        logger.warning(f"smartctl returned non-JSON for {device}")
        return None
    except Exception as e:
        logger.warning(f"smartctl error for {device}: {e}")
        return None


def extract_health(device: str, data: dict) -> dict:
    """Extract the key health fields from a smartctl JSON blob."""
    smart_status     = data.get("smart_status", {})
    device_info      = data.get("device", {})
    model_family     = data.get("model_family", "")
    model_name       = data.get("model_name", device_info.get("name", device))
    serial           = data.get("serial_number", "")
    capacity_bytes   = data.get("user_capacity", {}).get("bytes", 0)
    temperature      = None
    power_on_hours   = None
    critical_warnings: list[dict] = []

    # Extract temperature
    temp = data.get("temperature", {})
    if temp:
        temperature = temp.get("current")

    # Parse ATA attributes (HDDs)
    for attr in data.get("ata_smart_attributes", {}).get("table", []):
        attr_id   = attr.get("id")
        raw_value = attr.get("raw", {}).get("value", 0)
        if attr_id == 9:
            power_on_hours = raw_value
        if attr_id in CRITICAL_ATTRS and raw_value > 0:
            critical_warnings.append({
                "attr_id":   attr_id,
                "attr_name": CRITICAL_ATTRS[attr_id],
                "raw_value": raw_value,
            })

    # NVMe attributes
    nvme_log = data.get("nvme_smart_health_information_log", {})
    if nvme_log:
        if nvme_log.get("media_errors", 0) > 0:
            critical_warnings.append({
                "attr_id":   198,
                "attr_name": "NVMe Media Errors",
                "raw_value": nvme_log["media_errors"],
            })
        power_on_hours = power_on_hours or nvme_log.get("power_on_hours")

    passed = smart_status.get("passed", True)
    status = "healthy"
    if not passed:
        status = "failed"
    elif critical_warnings:
        status = "warning"

    return {
        "device":            device,
        "model":             model_name,
        "model_family":      model_family,
        "serial":            serial,
        "capacity_bytes":    capacity_bytes,
        "temperature_c":     temperature,
        "power_on_hours":    power_on_hours,
        "smart_passed":      passed,
        "status":            status,
        "critical_warnings": critical_warnings,
        "polled_at":         datetime.now(timezone.utc).isoformat(),
    }


async def poll_and_publish(nc: nats.aio.client.Client, devices: list[str]) -> None:
    loop = asyncio.get_event_loop()
    for device in devices:
        data = await loop.run_in_executor(None, read_smart, device)
        if data is None:
            continue

        health = extract_health(device, data)
        await nc.publish("phonolith.health.smart", json.dumps(health).encode())
        logger.info(f"SMART {device}: {health['status']} | temp={health['temperature_c']}°C | hours={health['power_on_hours']}")

        if health["status"] in ("warning", "failed"):
            alert = {
                "severity": "critical" if health["status"] == "failed" else "warning",
                "source":   "smart",
                "device":   device,
                "model":    health["model"],
                "message":  f"Drive {device} ({health['model']}) has {len(health['critical_warnings'])} SMART warning(s): "
                            + ", ".join(f"{w['attr_name']}={w['raw_value']}" for w in health["critical_warnings"]),
                "warnings": health["critical_warnings"],
                "timestamp": health["polled_at"],
            }
            await nc.publish("phonolith.health.alert", json.dumps(alert).encode())
            logger.warning(f"SMART alert for {device}: {alert['message']}")


async def main():
    logger.info(f"SMART monitor starting — poll interval {POLL_INTERVAL}s")

    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    if DEVICES_ENV:
        devices = [d.strip() for d in DEVICES_ENV.split(",") if d.strip()]
    else:
        devices = auto_detect_devices()

    if not devices:
        logger.warning("No devices to monitor. Set DEVICES env var or ensure smartctl --scan works.")

    logger.info(f"Monitoring {len(devices)} device(s): {devices}")

    while True:
        await poll_and_publish(nc, devices)
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
