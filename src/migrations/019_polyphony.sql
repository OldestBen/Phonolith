-- Polyphony: peer-to-peer Phonolith network.
--
-- Trust is established explicitly via a one-time pairing code exchanged
-- out-of-band (typed in by an admin, or auto-filled from LAN mDNS discovery
-- which only reveals a peer's name/host — never its library). Once paired,
-- a peer is "trusted" and each capability (library browsing/streaming,
-- presence, backup mirroring) is independently toggleable and defaults
-- conservatively (backup mirroring starts disabled, since it consumes the
-- remote peer's disk and should be a deliberate choice).

CREATE TABLE IF NOT EXISTS peers (
  id             TEXT PRIMARY KEY,                 -- the peer's own polyphony_peer_id (UUID)
  name           TEXT NOT NULL,
  host           TEXT NOT NULL,                    -- base URL, e.g. https://peer.example.com
  shared_secret  TEXT NOT NULL,                    -- hex HMAC key, used to sign/verify peer requests
  trust_status   TEXT NOT NULL DEFAULT 'trusted',  -- 'trusted' | 'blocked'
  share_library  BOOLEAN NOT NULL DEFAULT TRUE,    -- let this peer browse/stream our library
  share_presence BOOLEAN NOT NULL DEFAULT TRUE,    -- let this peer see our now-playing
  share_backup   BOOLEAN NOT NULL DEFAULT FALSE,   -- accept backup snapshots pushed by this peer
  paired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS peer_pairing_codes (
  code        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_backups (
  id            SERIAL PRIMARY KEY,
  peer_id       TEXT NOT NULL REFERENCES peers(id) ON DELETE CASCADE,
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  size_bytes    BIGINT NOT NULL,
  storage_path  TEXT NOT NULL,        -- where the mirrored snapshot is stored locally
  checksum      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_peer_backups_peer_id ON peer_backups(peer_id);
