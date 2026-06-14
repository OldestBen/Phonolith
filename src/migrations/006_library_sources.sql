CREATE TABLE library_sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('local', 'smb', 'nfs', 'iscsi')),
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
