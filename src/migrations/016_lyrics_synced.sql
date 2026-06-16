-- LRCLIB-sourced time-synced lyrics (LRC format), kept alongside the existing
-- plain-text content so the frontend can later render a synced view.
ALTER TABLE lyrics
  ADD COLUMN IF NOT EXISTS synced_lyrics TEXT;
