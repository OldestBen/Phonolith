ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS accuraterip_status TEXT,   -- 'verified' | 'not_found' | 'mismatch' | null
  ADD COLUMN IF NOT EXISTS accuraterip_confidence INT,
  ADD COLUMN IF NOT EXISTS mb_release_group_id TEXT;
