import asyncio, json, os, sqlite3
from datetime import datetime, timezone
from loguru import logger
import nats
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, PrivateFormat, PublicFormat, NoEncryption,
    load_pem_private_key,
)
import base64

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")
KEYS_DIR = os.getenv("KEYS_DIR", "/keys")
KEY_PATH = os.path.join(KEYS_DIR, "polyphony_key.pem")
BITFORGE_DB = os.path.join(DATA_DIR, "bitforge.db")

# Registered peers: alias -> public_key_bytes (base64)
peers: dict[str, str] = {}


def load_or_generate_keypair() -> Ed25519PrivateKey:
    os.makedirs(KEYS_DIR, exist_ok=True)
    if os.path.exists(KEY_PATH):
        with open(KEY_PATH, "rb") as f:
            private_key = load_pem_private_key(f.read(), password=None)
        logger.info(f"Loaded Ed25519 keypair from {KEY_PATH}")
    else:
        private_key = Ed25519PrivateKey.generate()
        pem = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        with open(KEY_PATH, "wb") as f:
            f.write(pem)
        logger.info(f"Generated new Ed25519 keypair, saved to {KEY_PATH}")
    return private_key


def get_local_hashes() -> set[str]:
    """Read all track hashes from the local BitForge SQLite DB."""
    if not os.path.exists(BITFORGE_DB):
        logger.warning(f"BitForge DB not found at {BITFORGE_DB}, returning empty set")
        return set()
    try:
        conn = sqlite3.connect(BITFORGE_DB)
        cursor = conn.execute("SELECT hash FROM tracks WHERE hash IS NOT NULL")
        hashes = {row[0] for row in cursor.fetchall()}
        conn.close()
        logger.debug(f"Loaded {len(hashes)} hashes from local BitForge DB")
        return hashes
    except Exception as e:
        logger.error(f"Failed to read BitForge DB: {e}")
        return set()


async def handle_handshake(msg, nc: nats.aio.client.Client, private_key: Ed25519PrivateKey):
    try:
        payload = json.loads(msg.data.decode())
        alias = payload.get("alias")
        peer_pubkey_b64 = payload.get("public_key")

        if not alias or not peer_pubkey_b64:
            logger.warning("Handshake missing alias or public_key")
            return

        peers[alias] = peer_pubkey_b64
        logger.info(f"Registered peer: {alias} (public_key: {peer_pubkey_b64[:16]}...)")

        # Sign a challenge with our private key to prove identity
        challenge = f"polyphony-handshake:{alias}:{datetime.now(timezone.utc).isoformat()}".encode()
        signature = private_key.sign(challenge)

        public_key = private_key.public_key()
        our_pubkey_b64 = base64.b64encode(
            public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
        ).decode()

        response = {
            "status": "registered",
            "alias": alias,
            "our_public_key": our_pubkey_b64,
            "signature": base64.b64encode(signature).decode(),
            "challenge": base64.b64encode(challenge).decode(),
            "peer_count": len(peers),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await nc.publish("phonolith.polyphony.peer.registered", json.dumps(response).encode())
    except Exception as e:
        logger.exception(f"Error handling handshake: {e}")


async def handle_diff_request(msg, nc: nats.aio.client.Client):
    try:
        payload = json.loads(msg.data.decode())
        peer_alias = payload.get("alias", "unknown")
        peer_hashes: list[str] = payload.get("hashes", [])

        local_hashes = get_local_hashes()
        peer_hash_set = set(peer_hashes)

        only_local = local_hashes - peer_hash_set
        only_peer = peer_hash_set - local_hashes
        common = local_hashes & peer_hash_set

        logger.info(
            f"Diff with peer '{peer_alias}': common={len(common)}, "
            f"only_local={len(only_local)}, only_peer={len(only_peer)}"
        )

        result = {
            "peer_alias": peer_alias,
            "summary": {
                "common_count": len(common),
                "only_local_count": len(only_local),
                "only_peer_count": len(only_peer),
            },
            "only_local": list(only_local)[:500],   # cap to avoid huge payloads
            "only_peer": list(only_peer)[:500],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await nc.publish("phonolith.polyphony.diff.result", json.dumps(result).encode())
    except Exception as e:
        logger.exception(f"Error handling diff request: {e}")


async def main():
    logger.info(f"Polyphony starting, connecting to NATS at {NATS_URL}")
    private_key = load_or_generate_keypair()

    public_key = private_key.public_key()
    our_pubkey_b64 = base64.b64encode(
        public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    ).decode()
    logger.info(f"Our public key: {our_pubkey_b64}")

    nc = await nats.connect(NATS_URL)
    logger.info("Connected to NATS")

    await nc.subscribe(
        "phonolith.polyphony.peer.handshake",
        cb=lambda msg: asyncio.create_task(handle_handshake(msg, nc, private_key)),
    )
    await nc.subscribe(
        "phonolith.polyphony.diff.request",
        cb=lambda msg: asyncio.create_task(handle_diff_request(msg, nc)),
    )
    logger.info("Polyphony ready — listening for handshake and diff requests")

    while True:
        await asyncio.sleep(300)
        logger.info(f"Polyphony alive — {len(peers)} registered peers")


if __name__ == "__main__":
    asyncio.run(main())
