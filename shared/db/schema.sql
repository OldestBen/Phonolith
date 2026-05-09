-- Phonolith — DuckDB Analytics Schema
-- Owned exclusively by EchoGraph (writer); API reads in read-only mode.
-- Operational state (Engram tag journal, Bit-Forge dedup index) lives in
-- per-service SQLite files under /data/.

-- ── Core library ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tracks (
    -- Identity
    id               VARCHAR PRIMARY KEY,  -- BLAKE3 hash (follows file across moves)
    path             VARCHAR NOT NULL,
    filename         VARCHAR NOT NULL,
    size_bytes       BIGINT,
    -- Audio format
    format           VARCHAR,              -- FLAC, MP3, AAC, DSF, WAV …
    bit_depth        INTEGER,
    sample_rate      INTEGER,
    bitrate_kbps     INTEGER,
    channels         INTEGER,
    duration_seconds DOUBLE,
    -- Core tags
    title            VARCHAR,
    artist           VARCHAR,
    album_artist     VARCHAR,
    album            VARCHAR,
    year             INTEGER,
    track_number     INTEGER,
    disc_number      INTEGER,
    genre            VARCHAR,
    label            VARCHAR,
    -- Extended credits
    composer         VARCHAR,
    lyricist         VARCHAR,
    engineer         VARCHAR,
    mixer            VARCHAR,
    mastered_by      VARCHAR,
    remixed_by       VARCHAR,
    -- Acoustic metadata
    bpm              DOUBLE,
    initial_key      VARCHAR,
    mood             VARCHAR,
    -- External IDs
    musicbrainz_track_id         VARCHAR,
    musicbrainz_release_id       VARCHAR,
    musicbrainz_release_group_id VARCHAR,
    musicbrainz_artist_id        VARCHAR,
    acoustid                     VARCHAR,
    discogs_release_id           VARCHAR,
    -- Ratings
    embedded_rating  INTEGER,   -- POPM/RATING 0-255
    lastfm_playcount INTEGER,
    plex_rating      DOUBLE,
    internal_rating  DOUBLE,    -- composite: weighted playcount + manual rating
    -- Prism (spectral fraud detection)
    prism_status         VARCHAR DEFAULT 'pending',  -- pending|clean|suspect|fraud
    prism_fraud_reason   VARCHAR,
    spectral_cutoff_hz   INTEGER,
    spectrogram_path     VARCHAR,
    accuraterip_result   VARCHAR,                    -- match|no-match|unknown
    -- Crest (dynamic range)
    dr_score         INTEGER,
    peak_level       DOUBLE,
    rms_level        DOUBLE,
    crest_factor     DOUBLE,
    -- Version management
    is_primary_version BOOLEAN DEFAULT TRUE,
    is_shadowed        BOOLEAN DEFAULT FALSE,
    -- Timestamps
    ingested_at      TIMESTAMPTZ DEFAULT now(),
    last_analyzed_at TIMESTAMPTZ,
    last_played_at   TIMESTAMPTZ,
    last_scanned_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS albums (
    id                           VARCHAR PRIMARY KEY,
    musicbrainz_release_group_id VARCHAR,
    title                        VARCHAR NOT NULL,
    artist                       VARCHAR,
    year                         INTEGER,
    label                        VARCHAR,
    total_tracks                 INTEGER,
    total_discs                  INTEGER,
    artwork_path                 VARCHAR,
    artwork_width                INTEGER,
    artwork_height               INTEGER,
    avg_dr_score                 DOUBLE,
    preferred_version_id         VARCHAR,  -- FK → release_versions.id
    discogs_release_id           VARCHAR,
    discogs_market_value         DOUBLE,
    created_at                   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artists (
    id               VARCHAR PRIMARY KEY,  -- musicbrainz_artist_id or slug
    name             VARCHAR NOT NULL,
    musicbrainz_id   VARCHAR,
    discogs_id       VARCHAR,
    track_count      INTEGER DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Hash-addressed file identity ─────────────────────────────────────────────
-- Records the full path history for each BLAKE3 hash.
-- A file's play history and metadata history follow the hash, never the path.

CREATE TABLE IF NOT EXISTS track_hashes (
    blake3_hash  VARCHAR NOT NULL,
    path         VARCHAR NOT NULL,
    event_type   VARCHAR NOT NULL,  -- created|modified|moved_from|moved_to|deleted
    recorded_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (blake3_hash, path, recorded_at)
);

-- ── Release version manager ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS release_versions (
    id                           VARCHAR PRIMARY KEY,
    musicbrainz_release_group_id VARCHAR,
    blake3_hash                  VARCHAR NOT NULL,
    version_label                VARCHAR,   -- '1987 Japanese Master'
    release_country              VARCHAR,
    release_year                 INTEGER,
    release_format               VARCHAR,   -- 'SHM-SACD', 'HD Download', 'CD'
    dr_score                     INTEGER,
    peak_level                   DOUBLE,
    rms_level                    DOUBLE,
    is_preferred                 BOOLEAN DEFAULT FALSE,
    is_shadowed                  BOOLEAN DEFAULT FALSE,
    notes                        VARCHAR
);

-- ── EchoGraph: scrobble / play history ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS play_events (
    id                     VARCHAR PRIMARY KEY,
    blake3_hash            VARCHAR NOT NULL,
    played_at              TIMESTAMPTZ NOT NULL,
    duration_played_secs   DOUBLE,
    completed              BOOLEAN DEFAULT FALSE,
    source                 VARCHAR,  -- lucid|flux|plex|lastfm_import|proxy
    endpoint_id            VARCHAR,  -- FK → hardware_endpoints.id
    format_played          VARCHAR,
    bitrate_played         INTEGER
);

-- ── Cathode: hardware endpoints ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hardware_endpoints (
    id                VARCHAR PRIMARY KEY,
    name              VARCHAR NOT NULL,
    type              VARCHAR NOT NULL,   -- dac|headphone|speaker|airplay|dap
    model             VARCHAR,
    connection_type   VARCHAR,            -- alsa_usb|airplay1|airplay2|network
    airplay_id        VARCHAR,
    max_sample_rate   INTEGER,
    max_bit_depth     INTEGER,
    supports_dsd      BOOLEAN DEFAULT FALSE,
    total_play_hours  DOUBLE DEFAULT 0.0,
    notes             VARCHAR,
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Aegis: vault chunk manifest ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vault_objects (
    id                VARCHAR PRIMARY KEY,  -- chunk BLAKE3 hash
    blake3_hash       VARCHAR NOT NULL,     -- parent file hash
    chunk_index       INTEGER,
    s3_bucket         VARCHAR,
    s3_key            VARCHAR NOT NULL,
    s3_endpoint       VARCHAR,
    tier              VARCHAR NOT NULL,     -- hot|cold
    size_bytes        BIGINT,
    encrypted         BOOLEAN DEFAULT TRUE,
    object_lock_until TIMESTAMPTZ,
    uploaded_at       TIMESTAMPTZ DEFAULT now(),
    last_verified_at  TIMESTAMPTZ
);

-- ── Polyphony: trusted peer nodes ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS peer_nodes (
    id                VARCHAR PRIMARY KEY,
    alias             VARCHAR NOT NULL,
    public_key        VARCHAR NOT NULL,
    wireguard_endpoint VARCHAR,
    last_seen_at      TIMESTAMPTZ,
    is_trusted        BOOLEAN DEFAULT FALSE,
    shared_track_count INTEGER DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── DAP provisioning profiles ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dap_profiles (
    id               VARCHAR PRIMARY KEY,
    name             VARCHAR NOT NULL,
    model            VARCHAR,
    storage_limit_gb DOUBLE,
    max_sample_rate  INTEGER,
    max_bit_depth    INTEGER,
    supports_dsd     BOOLEAN DEFAULT FALSE,
    rules_json       JSON,
    last_synced_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Per-album EQ profiles ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eq_profiles (
    id                   VARCHAR PRIMARY KEY,
    blake3_hash          VARCHAR,  -- NULL = album-level
    album_id             VARCHAR,
    label                VARCHAR NOT NULL,
    peq_json             JSON,     -- parametric EQ bands
    convolution_file_path VARCHAR,
    notes                VARCHAR,
    created_at           TIMESTAMPTZ DEFAULT now()
);

-- ── Acoustic analysis features (Prism + Crest extended) ──────────────────────

CREATE TABLE IF NOT EXISTS acoustic_features (
    blake3_hash       VARCHAR PRIMARY KEY,
    bpm_detected      DOUBLE,
    key_detected      VARCHAR,
    loudness_lufs     DOUBLE,
    energy            DOUBLE,
    danceability      DOUBLE,
    valence           DOUBLE,
    acousticness      DOUBLE,
    instrumentalness  DOUBLE,
    embedding_json    JSON,   -- vector embedding for semantic search
    analyzed_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tracks_artist     ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album      ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_genre      ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_year       ON tracks(year);
CREATE INDEX IF NOT EXISTS idx_tracks_dr         ON tracks(dr_score);
CREATE INDEX IF NOT EXISTS idx_tracks_rating     ON tracks(internal_rating);
CREATE INDEX IF NOT EXISTS idx_tracks_played     ON tracks(last_played_at);
CREATE INDEX IF NOT EXISTS idx_play_events_hash  ON play_events(blake3_hash);
CREATE INDEX IF NOT EXISTS idx_play_events_time  ON play_events(played_at);
CREATE INDEX IF NOT EXISTS idx_track_hashes_hash ON track_hashes(blake3_hash);
