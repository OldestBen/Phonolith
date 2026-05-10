"""
SNMP NAS Monitoring Service
Polls Synology / QNAP NAS appliances via SNMP for drive health, RAID status,
temperature, and fan speed. Publishes reports to phonolith.health.nas.
"""
import asyncio, json, os
from datetime import datetime, timezone
from loguru import logger
import nats

NATS_URL      = os.getenv("NATS_URL", "nats://localhost:4222")
NAS_HOSTS     = os.getenv("NAS_HOSTS", "")          # comma-separated: ip[:community]
POLL_INTERVAL = int(os.getenv("SNMP_POLL_INTERVAL_SECS", "300"))
SNMP_COMMUNITY = os.getenv("SNMP_COMMUNITY", "public")

# ── SNMP OIDs ─────────────────────────────────────────────────────────────────
# Synology MIB: 1.3.6.1.4.1.6574
# QNAP MIB:     1.3.6.1.4.1.24681

OIDS = {
    "sys_uptime":            "1.3.6.1.2.1.1.3.0",
    "sys_descr":             "1.3.6.1.2.1.1.1.0",
    # Synology-specific
    "synology_model":        "1.3.6.1.4.1.6574.1.5.1.0",
    "synology_serial":       "1.3.6.1.4.1.6574.1.5.2.0",
    "synology_temp":         "1.3.6.1.4.1.6574.1.2.0",
    "synology_fan_rpm":      "1.3.6.1.4.1.6574.1.4.1.0",
    "synology_sys_status":   "1.3.6.1.4.1.6574.1.1.0",   # 1=normal
    "synology_disk_table":   "1.3.6.1.4.1.6574.2",
    "synology_raid_table":   "1.3.6.1.4.1.6574.3",
    # QNAP-specific
    "qnap_model":            "1.3.6.1.4.1.24681.1.2.12.0",
    "qnap_sys_temp":         "1.3.6.1.4.1.24681.1.2.6.0",
    "qnap_disk_table":       "1.3.6.1.4.1.24681.1.2.11",
}

SYNOLOGY_DISK_STATUS = {
    1: "Normal", 2: "Initialized", 3: "NotInitialized",
    4: "SystemPartitionFailed", 5: "Crashed",
}

SYNOLOGY_RAID_STATUS = {
    1: "Normal", 2: "Repairing", 3: "Migrating", 4: "Expanding",
    5: "Deleting", 6: "Creating", 7: "RaidSyncing", 8: "RaidParityChecking",
    9: "RaidAssembling", 10: "Cancelling", 11: "Degrade", 12: "Crashed",
}


async def poll_host(host: str, community: str, nc) -> None:
    try:
        from pysnmp.hlapi.asyncio import (
            getCmd, nextCmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity,
        )
    except ImportError:
        logger.error("pysnmp not installed — SNMP polling disabled")
        return

    report: dict = {
        "host": host,
        "community": community,
        "polled_at": datetime.now(timezone.utc).isoformat(),
        "reachable": False,
        "model": None,
        "temperature_c": None,
        "fan_rpm": None,
        "system_status": None,
        "disks": [],
        "raids": [],
        "warnings": [],
    }

    engine = SnmpEngine()
    target = UdpTransportTarget((host, 161), timeout=5, retries=1)
    auth = CommunityData(community)

    async def get(oid: str):
        err_indication, err_status, _, var_binds = await getCmd(
            engine, auth, target, ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        if err_indication or err_status:
            return None
        for _, val in var_binds:
            return val.prettyPrint()
        return None

    try:
        descr = await get(OIDS["sys_descr"])
        if descr is None:
            report["warnings"].append("Host unreachable or SNMP not enabled")
            await nc.publish("phonolith.health.nas", json.dumps(report).encode())
            return

        report["reachable"] = True

        # Try Synology first
        model = await get(OIDS["synology_model"])
        if model:
            report["model"] = model
            report["vendor"] = "synology"
            temp = await get(OIDS["synology_temp"])
            if temp: report["temperature_c"] = int(temp)
            fan = await get(OIDS["synology_fan_rpm"])
            if fan: report["fan_rpm"] = int(fan)
            sys_status = await get(OIDS["synology_sys_status"])
            if sys_status:
                report["system_status"] = "Normal" if sys_status == "1" else "Degraded"
                if sys_status != "1":
                    report["warnings"].append(f"System status: {sys_status}")

            # Walk disk table
            disk_idx = 0
            while True:
                disk_model = await get(f"1.3.6.1.4.1.6574.2.1.1.2.{disk_idx}")
                if disk_model is None:
                    break
                disk_status = await get(f"1.3.6.1.4.1.6574.2.1.1.5.{disk_idx}")
                disk_temp = await get(f"1.3.6.1.4.1.6574.2.1.1.6.{disk_idx}")
                status_str = SYNOLOGY_DISK_STATUS.get(int(disk_status or 0), "Unknown")
                report["disks"].append({
                    "index": disk_idx,
                    "model": disk_model,
                    "status": status_str,
                    "temperature_c": int(disk_temp) if disk_temp else None,
                })
                if status_str not in ("Normal", "Initialized"):
                    report["warnings"].append(f"Disk {disk_idx} ({disk_model}): {status_str}")
                disk_idx += 1
        else:
            # Try QNAP
            qnap_model = await get(OIDS["qnap_model"])
            if qnap_model:
                report["model"] = qnap_model
                report["vendor"] = "qnap"
                temp = await get(OIDS["qnap_sys_temp"])
                if temp: report["temperature_c"] = int(temp.rstrip(" C").strip())

        logger.info(
            f"NAS {host}: {report.get('vendor', 'unknown')} {report.get('model', '?')}, "
            f"temp={report.get('temperature_c')}°C, "
            f"{len(report['disks'])} disks, {len(report['warnings'])} warnings"
        )

    except Exception as e:
        report["warnings"].append(str(e))
        logger.exception(f"SNMP poll error for {host}: {e}")

    await nc.publish("phonolith.health.nas", json.dumps(report).encode())


async def main():
    logger.info(f"SNMP NAS monitoring starting, poll interval: {POLL_INTERVAL}s")
    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    hosts_raw = [h.strip() for h in NAS_HOSTS.split(",") if h.strip()]
    if not hosts_raw:
        logger.info("No NAS_HOSTS configured — idle. Set NAS_HOSTS=ip:community,... in .env")

    while True:
        for entry in hosts_raw:
            parts = entry.split(":")
            host = parts[0]
            community = parts[1] if len(parts) > 1 else SNMP_COMMUNITY
            asyncio.create_task(poll_host(host, community, nc))
        if hosts_raw:
            await asyncio.sleep(POLL_INTERVAL)
        else:
            await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(main())
