CREATE TABLE IF NOT EXISTS history (
  id         SERIAL PRIMARY KEY,
  song_id    INTEGER REFERENCES songs(id),
  artist_id  INTEGER REFERENCES artists(id),
  event      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_artist_id ON history(artist_id);
CREATE INDEX IF NOT EXISTS idx_history_song_id ON history(song_id);
