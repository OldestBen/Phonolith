-- ENGINEER credit (mastering/mixing/recording engineer) read by Lexicon
-- from ID3 TXXX:ENGINEER / TIPL / TMCL frames or the FLAC/Vorbis 'engineer' comment.
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS engineer TEXT;
