-- Soulcatcher: Soulseek search/download feature, backed by the slskd sidecar.
--
-- slskd is the source of truth for in-flight transfer state while a download
-- is active, but it doesn't retain history once a transfer is removed/cleared
-- on its side. This table is Phonolith's own durable record of every download
-- ever requested, so the UI can show history without re-polling slskd for
-- everything and without losing the record once slskd forgets about it.

CREATE TABLE IF NOT EXISTS soulcatcher_downloads (
  id            SERIAL PRIMARY KEY,
  query         TEXT NOT NULL,                       -- the search query that produced this result
  username      TEXT NOT NULL,                        -- the Soulseek peer offering the file
  filename      TEXT NOT NULL,                        -- remote filename/path as reported by slskd
  size_bytes    BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',        -- 'queued' | 'downloading' | 'completed' | 'failed'
  local_path    TEXT,                                  -- set once ingested into the library
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_soulcatcher_downloads_status ON soulcatcher_downloads(status);
CREATE INDEX IF NOT EXISTS idx_soulcatcher_downloads_requested_at ON soulcatcher_downloads(requested_at DESC);
