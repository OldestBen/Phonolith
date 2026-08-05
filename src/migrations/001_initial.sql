CREATE TABLE IF NOT EXISTS artists (
  id          SERIAL PRIMARY KEY,
  genius_id   INTEGER UNIQUE,
  mb_id       UUID,
  name        TEXT NOT NULL,
  image_url   TEXT,
  description TEXT,
  followers   INTEGER,
  fetched_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS albums (
  id            SERIAL PRIMARY KEY,
  genius_id     INTEGER UNIQUE,
  mb_id         UUID,
  artist_id     INTEGER REFERENCES artists(id),
  name          TEXT NOT NULL,
  cover_art_url TEXT,
  release_date  DATE,
  fetched_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS songs (
  id                    SERIAL PRIMARY KEY,
  genius_id             INTEGER UNIQUE,
  mb_id                 UUID,
  artist_id             INTEGER REFERENCES artists(id),
  album_id              INTEGER REFERENCES albums(id),
  title                 TEXT NOT NULL,
  full_title            TEXT,
  path                  TEXT,
  release_date          DATE,
  song_art_image_url    TEXT,
  description           TEXT,
  pageviews             INTEGER,
  fetched_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lyrics (
  song_id     INTEGER PRIMARY KEY REFERENCES songs(id),
  content     TEXT,
  scraped_at  TIMESTAMPTZ
);
