-- PREFERRED VERSION: lets the user explicitly pin one pressing/master as
-- their chosen version for an album, overriding the DR-sorted default the
-- version comparison UI computes client-side. "Version" is a derived
-- signature (format/bit_depth/sample_rate) rather than a normalized table,
-- so the flag lives on library_files and is kept mutually exclusive within
-- an album by the PATCH route (set true for every file matching the chosen
-- signature, false for all other files on the album) rather than by a DB
-- constraint.
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS is_preferred BOOLEAN NOT NULL DEFAULT false;
