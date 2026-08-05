export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()

  // Grouping used to be a bare `GROUP BY album, artist` on the raw embedded
  // tags — any inconsistency between files of the same physical album (case,
  // trailing whitespace, a stray "(Remastered)") silently split one album
  // into several fragments, each showing only a subset of its tracks. Two
  // layers fix this:
  //  1. Files that are matched to a real album (via songs.album_id) group by
  //     that album's real id — the authoritative case.
  //  2. Unmatched files fall back to a case/whitespace-normalized text key,
  //     AND get folded into an existing matched album's group if their
  //     normalized raw text equals that album's normalized name/artist —
  //     so a mix of matched and not-yet-matched files for the same physical
  //     album still end up as one row instead of two.
  const rows = await sql`
    WITH canon AS (
      SELECT al.id AS album_id, al.name AS album_name, ar.name AS artist_name,
             lower(trim(al.name)) AS norm_album, lower(trim(ar.name)) AS norm_artist
      FROM albums al
      JOIN artists ar ON ar.id = al.artist_id
    ),
    keyed AS (
      SELECT
        lf.blake3_hash, lf.cover_art_path, lf.year, lf.album AS raw_album, lf.artist AS raw_artist,
        COALESCE(s.album_id, c.album_id) AS resolved_album_id,
        lower(trim(COALESCE(lf.album, ''))) || '::' || lower(trim(COALESCE(lf.artist, ''))) AS raw_key
      FROM library_files lf
      LEFT JOIN songs s ON s.id = lf.song_id
      LEFT JOIN canon c
        ON c.norm_album = lower(trim(COALESCE(lf.album, '')))
       AND c.norm_artist = lower(trim(COALESCE(lf.artist, '')))
      WHERE lf.album IS NOT NULL
    )
    SELECT
      canon.album_id                                    AS album_id,
      COALESCE(canon.album_name, MAX(k.raw_album))       AS album,
      COALESCE(canon.artist_name, MAX(k.raw_artist))     AS artist,
      MIN(k.year)                                        AS year,
      COUNT(*)::int                                      AS track_count,
      (ARRAY_AGG(k.blake3_hash ORDER BY k.cover_art_path NULLS LAST))[1] AS cover_hash,
      BOOL_OR(k.cover_art_path IS NOT NULL)               AS has_cover
    FROM keyed k
    LEFT JOIN canon ON canon.album_id = k.resolved_album_id
    WHERE ${q ? sql`(k.raw_album ILIKE ${'%' + q + '%'} OR k.raw_artist ILIKE ${'%' + q + '%'} OR canon.album_name ILIKE ${'%' + q + '%'} OR canon.artist_name ILIKE ${'%' + q + '%'})` : sql`TRUE`}
    GROUP BY COALESCE(k.resolved_album_id::text, k.raw_key), canon.album_id, canon.album_name, canon.artist_name
    ORDER BY album ASC
  `

  return NextResponse.json(rows)
}
