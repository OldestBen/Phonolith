CREATE TABLE IF NOT EXISTS credits (
  id        SERIAL PRIMARY KEY,
  song_id   INTEGER REFERENCES songs(id),
  role      TEXT,
  name      TEXT,
  genius_id INTEGER
);

CREATE TABLE IF NOT EXISTS annotations (
  id         SERIAL PRIMARY KEY,
  song_id    INTEGER REFERENCES songs(id),
  fragment   TEXT,
  body       TEXT,
  source     TEXT DEFAULT 'genius',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
