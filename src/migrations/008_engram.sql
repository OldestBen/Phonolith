CREATE TABLE IF NOT EXISTS metadata_versions (
  id            SERIAL PRIMARY KEY,
  blake3_hash   TEXT NOT NULL,
  snapshot      JSONB NOT NULL,
  source        TEXT NOT NULL DEFAULT 'ingest',  -- 'ingest' | 'user' | 'lexicon' | 'musicbrainz'
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metadata_versions_hash ON metadata_versions(blake3_hash);
CREATE INDEX IF NOT EXISTS idx_metadata_versions_created ON metadata_versions(blake3_hash, created_at DESC);
