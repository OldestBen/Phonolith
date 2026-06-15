-- Restructure library_files to reference logical tracks and use relative paths.
-- file_path is kept (deprecated) to avoid breaking existing queries during transition;
-- relative_path + source_id is the canonical location going forward.
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS track_id     UUID REFERENCES tracks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_id    INT  REFERENCES library_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relative_path TEXT,             -- path relative to source root
  ADD COLUMN IF NOT EXISTS disc_number  INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS title        TEXT,              -- embedded tag (denormalised for speed)
  ADD COLUMN IF NOT EXISTS artist       TEXT,
  ADD COLUMN IF NOT EXISTS album        TEXT,
  ADD COLUMN IF NOT EXISTS year         TEXT,
  ADD COLUMN IF NOT EXISTS inode        BIGINT,            -- fast-path identity check
  ADD COLUMN IF NOT EXISTS file_size    BIGINT,
  ADD COLUMN IF NOT EXISTS mtime        BIGINT,            -- Unix timestamp (seconds)
  ADD COLUMN IF NOT EXISTS cover_art_path TEXT;            -- sharded: waveforms/a1/b2/hash_cover.jpg

CREATE INDEX IF NOT EXISTS idx_library_files_track_id    ON library_files(track_id);
CREATE INDEX IF NOT EXISTS idx_library_files_source_id   ON library_files(source_id);
CREATE INDEX IF NOT EXISTS idx_library_files_rel_path    ON library_files(source_id, relative_path);
CREATE INDEX IF NOT EXISTS idx_library_files_inode       ON library_files(source_id, inode, file_size, mtime);
