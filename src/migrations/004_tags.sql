CREATE TABLE IF NOT EXISTS tags (
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  color      TEXT DEFAULT '#a78bfa',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS song_tags (
  song_id INTEGER REFERENCES songs(id),
  tag_id  INTEGER REFERENCES tags(id),
  PRIMARY KEY (song_id, tag_id)
);
