-- Supports the library-wide Galaxy view (/api/visualize/galaxy/*), which is
-- the first place in the app that joins songs/credits/library_files at full
-- library scope rather than scoped to one artist_id. None of these join
-- columns had an index before now (checked every prior migration), so those
-- queries would otherwise be sequential scans over the whole songs/credits/
-- library_files tables on every request.
CREATE INDEX IF NOT EXISTS idx_songs_artist_id     ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_artist_id    ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_credits_song_id      ON credits(song_id);
CREATE INDEX IF NOT EXISTS idx_credits_name         ON credits(name);
