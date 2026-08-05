-- Plex-style metadata locking and user overrides on physical files.
-- metadata_locked: prevents automatic re-matching from overwriting manual edits.
-- metadata_overrides: field-level overrides stored as JSONB, merged at query time.
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS metadata_locked    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metadata_overrides JSONB;

-- Disc number on the Genius songs table too (for multi-disc album queries)
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS disc_number INT NOT NULL DEFAULT 1;

-- pg_trgm index for fuzzy search across title/artist/album in library_files
-- (loaded lazily — CREATE INDEX CONCURRENTLY not valid in a transaction,
--  but for initial schema setup this is fine)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_library_files_title_trgm  ON library_files USING gin(title  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_library_files_artist_trgm ON library_files USING gin(artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_library_files_album_trgm  ON library_files USING gin(album  gin_trgm_ops);
