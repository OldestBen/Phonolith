-- Logical track entity — independent of physical files
-- A track is matched by MusicBrainz Recording MBID or AcoustID fingerprint.
-- Multiple files (MP3, FLAC, different pressings) may point to the same track.
-- History, tags, and playlists attach here, never to the physical file.
CREATE TABLE IF NOT EXISTS tracks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mb_recording_id TEXT UNIQUE,          -- MusicBrainz Recording MBID (authoritative)
  acoustid        TEXT,                 -- AcoustID fingerprint (secondary match key)
  song_id         INTEGER REFERENCES songs(id) ON DELETE SET NULL,  -- Genius match
  title           TEXT,
  disc_number     INT NOT NULL DEFAULT 1,
  track_number    INT,
  duration_ms     INT,
  year            TEXT,
  album_name      TEXT,                 -- embedded tag fallback before MB match
  artist_name     TEXT,                 -- embedded tag fallback before MB match
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracks_mb_recording ON tracks(mb_recording_id);
CREATE INDEX IF NOT EXISTS idx_tracks_acoustid      ON tracks(acoustid);
CREATE INDEX IF NOT EXISTS idx_tracks_song_id       ON tracks(song_id);

-- Contributors: people with a named role in a track's production
-- Distinct from the artists/songs tables which are Genius-sourced metadata.
CREATE TABLE IF NOT EXISTS contributors (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  mb_artist_id TEXT,
  genius_id    INT
);

-- Role-based join: composer, performer, conductor, producer, engineer, featured, mixer…
CREATE TABLE IF NOT EXISTS track_contributions (
  track_id       UUID REFERENCES tracks(id) ON DELETE CASCADE,
  contributor_id INT  REFERENCES contributors(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  PRIMARY KEY (track_id, contributor_id, role)
);

CREATE INDEX IF NOT EXISTS idx_track_contributions_contributor ON track_contributions(contributor_id);
CREATE INDEX IF NOT EXISTS idx_track_contributions_track       ON track_contributions(track_id);

-- Re-anchor history and song_tags to tracks as well as songs
-- (songs remain for Genius-sourced events; tracks for library play events)
ALTER TABLE history
  ADD COLUMN IF NOT EXISTS track_id UUID REFERENCES tracks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_history_track_id ON history(track_id);
