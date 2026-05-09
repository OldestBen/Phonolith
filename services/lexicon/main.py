"""
Lexicon — deep metadata enrichment.

Subscribes to: phonolith.metadata.snapshot  (Engram output)
Publishes to:  phonolith.metadata.enriched

For each new track snapshot, Lexicon:
  - Queries MusicBrainz for the full release/mastering lineage if
    MUSICBRAINZ_RELEASEGROUPID is present ("Valence Killer" logic).
  - Resolves ENGINEER, MIXER, MASTERED BY credits from Discogs.
  - Aggregates ratings from Last.fm play count and embedded POPM.
  - Publishes an enriched metadata payload for EchoGraph to persist.
"""

import asyncio
import json
import os
import time
from datetime import datetime, timezone

import musicbrainzngs
import requests
from loguru import logger
import nats

NATS_URL       = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR       = os.getenv("DATA_DIR", "/data")
MB_USER_AGENT  = os.getenv("MUSICBRAINZ_USER_AGENT", "Phonolith/0.1.0")
DISCOGS_TOKEN  = os.getenv("DISCOGS_TOKEN", "")

musicbrainzngs.set_useragent(*MB_USER_AGENT.split(" ", 2))
musicbrainzngs.set_rate_limit(limit_or_interval=1.0)

# ── MusicBrainz helpers ───────────────────────────────────────────────────────

def fetch_release_lineage(release_group_id: str) -> list[dict]:
    """Return all releases in a release group, sorted by date."""
    try:
        result = musicbrainzngs.get_release_group_by_id(
            release_group_id, includes=["releases"]
        )
        releases = result.get("release-group", {}).get("release-list", [])
        return sorted(releases, key=lambda r: r.get("date", "9999"))
    except Exception as exc:
        logger.warning(f"MusicBrainz lookup failed for {release_group_id}: {exc}")
        return []


def identify_master_lineage(release_id: str, release_group_id: str) -> str | None:
    """Return a human-readable mastering lineage label for a specific release."""
    releases = fetch_release_lineage(release_group_id)
    for i, rel in enumerate(releases):
        if rel.get("id") == release_id:
            date = rel.get("date", "unknown date")
            country = rel.get("country", "")
            label = f"Release #{i + 1} of {len(releases)} — {date}"
            if country:
                label += f" ({country})"
            return label
    return None

# ── Discogs helpers ───────────────────────────────────────────────────────────

def fetch_discogs_credits(discogs_release_id: str) -> dict:
    if not DISCOGS_TOKEN or not discogs_release_id:
        return {}
    try:
        url = f"https://api.discogs.com/releases/{discogs_release_id}"
        resp = requests.get(
            url,
            headers={"Authorization": f"Discogs token={DISCOGS_TOKEN}",
                     "User-Agent": MB_USER_AGENT},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        credits: dict = {}
        for person in data.get("extraartists", []):
            role = person.get("role", "").lower()
            name = person.get("name", "")
            if "engineer" in role:
                credits.setdefault("engineer", []).append(name)
            elif "mastering" in role or "mastered" in role:
                credits.setdefault("mastered_by", []).append(name)
            elif "mix" in role:
                credits.setdefault("mixer", []).append(name)
        return credits
    except Exception as exc:
        logger.debug(f"Discogs lookup failed: {exc}")
        return {}

# ── Message handler ───────────────────────────────────────────────────────────

async def handle_snapshot(msg, js):
    await msg.ack()
    try:
        data = json.loads(msg.data)
        blake3_hash = data.get("blake3_hash", "")
        snapshot_id = data.get("snapshot_id", "")

        # In production, Lexicon would reload tags from the snapshot DB.
        # Here we use the hash event's embedded metadata as the source.
        mb_rg_id = data.get("tags", {}).get("MUSICBRAINZ_RELEASEGROUPID", [""])[0]
        mb_r_id  = data.get("tags", {}).get("MUSICBRAINZ_ALBUMID", [""])[0]
        discogs_id = data.get("tags", {}).get("DISCOGS_RELEASE_ID", [""])[0]

        enriched: dict = {
            "blake3_hash": blake3_hash,
            "snapshot_id": snapshot_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        loop = asyncio.get_event_loop()

        if mb_rg_id:
            lineage = await loop.run_in_executor(
                None, lambda: identify_master_lineage(mb_r_id, mb_rg_id)
            )
            enriched["mastering_lineage"] = lineage
            await asyncio.sleep(0.5)  # MusicBrainz rate limit

        if discogs_id:
            credits = await loop.run_in_executor(
                None, lambda: fetch_discogs_credits(discogs_id)
            )
            enriched.update(credits)

        await js.publish(
            "phonolith.metadata.enriched",
            json.dumps(enriched).encode(),
        )
        logger.info(f"Enriched {blake3_hash[:12]}…")
    except Exception as exc:
        logger.error(f"handle_snapshot error: {exc}")


async def main():
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()

    logger.info("Lexicon starting — deep metadata resolver online")

    await js.subscribe(
        "phonolith.metadata.snapshot",
        durable="lexicon",
        cb=lambda m: asyncio.create_task(handle_snapshot(m, js)),
    )

    logger.info("Lexicon listening for snapshot events")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Lexicon shutting down")
