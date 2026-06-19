-- library_files was missing track_number; ingest route references it so every
-- insert was failing with "column does not exist", leaving the library empty.
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS track_number INT;

CREATE INDEX IF NOT EXISTS idx_library_files_track_number ON library_files(track_number);
