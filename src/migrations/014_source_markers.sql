-- Graceful offline support for library sources.
-- Before any cleanup pass, the scanner verifies the root marker file is accessible.
-- If it isn't, the source goes OFFLINE and all its files are preserved in the DB.
ALTER TABLE library_sources
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'offline' | 'error'
  ADD COLUMN IF NOT EXISTS root_marker_uuid TEXT,    -- UUID written to .phonolith_id at source root
  ADD COLUMN IF NOT EXISTS last_seen_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offline_since    TIMESTAMPTZ;

-- library_files reflects whether its source is currently reachable
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS source_online BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_library_files_source_online ON library_files(source_online) WHERE NOT source_online;
