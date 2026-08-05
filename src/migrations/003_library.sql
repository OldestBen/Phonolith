CREATE TABLE IF NOT EXISTS library_files (
  id            SERIAL PRIMARY KEY,
  blake3_hash   TEXT UNIQUE NOT NULL,
  file_path     TEXT NOT NULL,
  song_id       INTEGER REFERENCES songs(id),
  format        TEXT,
  bitrate       INTEGER,
  sample_rate   INTEGER,
  bit_depth     INTEGER,
  duration_ms   INTEGER,
  dr_score      REAL,
  spectral_ok   BOOLEAN,
  waveform_path TEXT,
  fingerprint   TEXT,
  indexed_at    TIMESTAMPTZ DEFAULT NOW()
);
