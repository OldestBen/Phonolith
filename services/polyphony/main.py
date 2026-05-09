import asyncio, json, os, sqlite3, uuid
from datetime import datetime, timezone
from loguru import logger
import nats
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, PrivateFormat, PublicFormat, NoEncryption,
    load_pem_private_key, load_der_public_key,
)
from cryptography.exceptions import InvalidSignature
import base64

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATA_DIR = os.getenv("DATA_DIR", "/data")
KEYS_DIR = os.getenv("KEYS_DIR", "/keys")
KEY_PATH = os.path.join(KEYS_DIR, "polyphony_key.pem")
BITFORGE_DB = os.path.join(DATA_DIR, "bitforge.db")
POLYPHONY_DB = os.path.join(DATA_DIR, "polyphony.db")

# Registered peers: alias -> public_key_bytes (base64-raw)
peers: dict[str, str] = {}

ALLOWED_FIX_FIELDS = {
    "title", "artist", "album", "album_artist", "year", "genre", "label",
    "composer", "lyricist", "engineer", "mixer", "mastered_by", "remixed_by",
    "bpm", "initial_key", "track_number", "disc_number",
}


# ── SQLite helpers ────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(POLYPHONY_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pending_fixes (
            id           TEXT PRIMARY KEY,
            blake3_hash  TEXT NOT NULL,
            field        TEXT NOT NULL,
            old_value    TEXT,
            new_value    TEXT NOT NULL,
            peer_alias   TEXT NOT NULL,
            peer_pubkey  TEXT NOT NULL,
            signature    TEXT NOT NULL,
            received_at  TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending'
        )
    """)
    conn.commit()
    return conn


def open_db() -> sqlite3.Connection:
    return sqlite3.connect(POLYPHONY_DB)


# ── Crypto helpers ────────────────────────────────────────────────────────────

def _sign_message(private_key: Ed25519PrivateKey, *parts: str) -> str:
    msg = "|".join(parts).encode()
    return base64.b64encode(private_key.sign(msg)).decode()


def _verify_message(pubkey_b64: str, signature_b64: str, *parts: str) -> bool:
    try:
        raw_pubkey = base64.b64decode(pubkey_b64)
        # load via DER public key interface — Ed25519 raw bytes is 32 bytes
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey as _PK
        from cryptography.hazmat.primitives.serialization import load_der_public_key
        # Build SubjectPublicKeyInfo DER manually for raw Ed25519 key
        # Alternatively use: Ed25519PublicKey.from_public_bytes (available in newer cryptography)
        public_key = _load_raw_ed25519_pubkey(raw_pubkey)
        sig = base64.b64decode(signature_b64)
        msg = "|".join(parts).encode()
        public_key.verify(sig, msg)
        return True
    except (InvalidSignature, Exception):
        return False


def _load_raw_ed25519_pubkey(raw: bytes) -> Ed25519PublicKey:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    # cryptography ≥ 2.6 supports from_public_bytes
    return Ed25519PublicKey.from_public_bytes(raw)


# ── Key management ────────────────────────────────────────────────────────────

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
    if not os.path.exists(BITFORGE_DB):
        logger.warning(f"BitForge DB not found at {BITFORGE_DB}")
        return set()
    try:
        conn = sqlite3.connect(BITFORGE_DB)
        hashes = {row[0] for row in conn.execute("SELECT hash FROM tracks WHERE hash IS NOT NULL").fetchall()}
        conn.close()
        return hashes
    except Exception as e:
        logger.error(f"Failed to read BitForge DB: {e}")
        return set()


# ── NATS handlers ─────────────────────────────────────────────────────────────

async def handle_handshake(msg, nc: nats.aio.client.Client, private_key: Ed25519PrivateKey):
    try:
        payload = json.loads(msg.data.decode())
        alias = payload.get("alias")
        peer_pubkey_b64 = payload.get("public_key")

        if not alias or not peer_pubkey_b64:
            logger.warning("Handshake missing alias or public_key")
            return

        peers[alias] = peer_pubkey_b64
        logger.info(f"Registered peer: {alias}")

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
        logger.exception(f"Handshake error: {e}")


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

        logger.info(f"Diff with '{peer_alias}': common={len(common)}, only_local={len(only_local)}, only_peer={len(only_peer)}")

        result = {
            "peer_alias": peer_alias,
            "summary": {
                "common_count": len(common),
                "only_local_count": len(only_local),
                "only_peer_count": len(only_peer),
            },
            "only_local": list(only_local)[:500],
            "only_peer": list(only_peer)[:500],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await nc.publish("phonolith.polyphony.diff.result", json.dumps(result).encode())
    except Exception as e:
        logger.exception(f"Diff error: {e}")


async def handle_fix_receive(msg, nc: nats.aio.client.Client):
    """A peer sent us a signed metadata correction. Verify and queue for approval."""
    try:
        payload = json.loads(msg.data.decode())
        peer_alias   = payload.get("peer_alias", "")
        blake3_hash  = payload.get("blake3_hash", "")
        field        = payload.get("field", "")
        new_value    = payload.get("new_value", "")
        old_value    = payload.get("old_value")
        timestamp    = payload.get("timestamp", "")
        signature    = payload.get("signature", "")

        if field not in ALLOWED_FIX_FIELDS:
            logger.warning(f"Rejected fix from '{peer_alias}': field '{field}' not allowed")
            return

        if peer_alias not in peers:
            logger.warning(f"Rejected fix from unknown peer '{peer_alias}'")
            return

        pubkey_b64 = peers[peer_alias]
        if not _verify_message(pubkey_b64, signature, blake3_hash, field, new_value, peer_alias, timestamp):
            logger.warning(f"Invalid signature on fix from '{peer_alias}' for {blake3_hash}/{field}")
            return

        fix_id = str(uuid.uuid4())
        conn = open_db()
        conn.execute(
            """INSERT INTO pending_fixes
               (id, blake3_hash, field, old_value, new_value, peer_alias, peer_pubkey, signature, received_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
            [fix_id, blake3_hash, field, old_value, new_value,
             peer_alias, pubkey_b64, signature, datetime.now(timezone.utc).isoformat()],
        )
        conn.commit()
        conn.close()
        logger.info(f"Queued fix {fix_id} from '{peer_alias}': {blake3_hash}/{field} → {new_value!r}")

        # Broadcast to any listening UI via NATS
        await nc.publish("phonolith.polyphony.fix.pending", json.dumps({
            "id": fix_id, "blake3_hash": blake3_hash, "field": field,
            "old_value": old_value, "new_value": new_value,
            "peer_alias": peer_alias, "timestamp": datetime.now(timezone.utc).isoformat(),
        }).encode())
    except Exception as e:
        logger.exception(f"Fix receive error: {e}")


async def handle_fix_publish(msg, nc: nats.aio.client.Client, private_key: Ed25519PrivateKey):
    """We're publishing a signed metadata fix to a peer (or broadcast)."""
    try:
        payload = json.loads(msg.data.decode())
        blake3_hash = payload.get("blake3_hash", "")
        field       = payload.get("field", "")
        new_value   = payload.get("new_value", "")
        old_value   = payload.get("old_value")
        target_peer = payload.get("target_peer")  # None = broadcast to all peers

        if field not in ALLOWED_FIX_FIELDS:
            logger.warning(f"Publish fix rejected: field '{field}' not allowed")
            return

        public_key = private_key.public_key()
        our_alias = base64.b64encode(
            public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
        ).decode()[:12]  # truncated for display; real identity = full pubkey

        timestamp = datetime.now(timezone.utc).isoformat()
        signature = _sign_message(private_key, blake3_hash, field, new_value, our_alias, timestamp)

        outbound = {
            "peer_alias": our_alias,
            "blake3_hash": blake3_hash,
            "field": field,
            "new_value": new_value,
            "old_value": old_value,
            "timestamp": timestamp,
            "signature": signature,
        }
        await nc.publish("phonolith.polyphony.fix.receive", json.dumps(outbound).encode())
        logger.info(f"Published fix for {blake3_hash}/{field} → {new_value!r}")
    except Exception as e:
        logger.exception(f"Fix publish error: {e}")


async def handle_fix_decision(msg, nc: nats.aio.client.Client):
    """User approved or rejected a pending fix. If approved, relay to EchoGraph."""
    try:
        payload = json.loads(msg.data.decode())
        fix_id  = payload.get("fix_id", "")
        action  = payload.get("action", "")  # 'approve' or 'reject'

        if action not in ("approve", "reject"):
            return

        conn = open_db()
        row = conn.execute(
            "SELECT blake3_hash, field, new_value FROM pending_fixes WHERE id = ? AND status = 'pending'",
            [fix_id],
        ).fetchone()

        if not row:
            conn.close()
            logger.warning(f"Fix decision for unknown/non-pending fix {fix_id}")
            return

        blake3_hash, field, new_value = row
        new_status = "approved" if action == "approve" else "rejected"
        conn.execute("UPDATE pending_fixes SET status = ? WHERE id = ?", [new_status, fix_id])
        conn.commit()
        conn.close()

        if action == "approve":
            await nc.publish("phonolith.polyphony.fix.approved", json.dumps({
                "fix_id": fix_id,
                "blake3_hash": blake3_hash,
                "field": field,
                "value": new_value,
            }).encode())
            logger.info(f"Approved fix {fix_id}: {blake3_hash}/{field} → {new_value!r}")
        else:
            logger.info(f"Rejected fix {fix_id}")
    except Exception as e:
        logger.exception(f"Fix decision error: {e}")


async def main():
    logger.info(f"Polyphony starting, connecting to NATS at {NATS_URL}")
    private_key = load_or_generate_keypair()

    public_key = private_key.public_key()
    our_pubkey_b64 = base64.b64encode(
        public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    ).decode()
    logger.info(f"Our public key: {our_pubkey_b64}")

    init_db()
    logger.info(f"Polyphony DB initialised at {POLYPHONY_DB}")

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
    await nc.subscribe(
        "phonolith.polyphony.fix.receive",
        cb=lambda msg: asyncio.create_task(handle_fix_receive(msg, nc)),
    )
    await nc.subscribe(
        "phonolith.polyphony.fix.publish",
        cb=lambda msg: asyncio.create_task(handle_fix_publish(msg, nc, private_key)),
    )
    await nc.subscribe(
        "phonolith.polyphony.fix.decision",
        cb=lambda msg: asyncio.create_task(handle_fix_decision(msg, nc)),
    )
    logger.info("Polyphony ready — listening for handshake, diff, and fix messages")

    while True:
        await asyncio.sleep(300)
        logger.info(f"Polyphony alive — {len(peers)} registered peers")


if __name__ == "__main__":
    asyncio.run(main())
