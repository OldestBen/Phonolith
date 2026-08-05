export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

// Returns albums that have a genuine "multiple pressings" situation — i.e. at
// least one song on the album has more than one distinct library file (a
// second rip/master/format of the same track), not merely an album whose
// tracks collectively add up to more than one file. (An N-track album with
// one file per song is the normal case and must NOT show up here — grouping
// by album alone and requiring COUNT(DISTINCT file) > 1 would match nearly
// every multi-track album in the library, which is wrong.)
export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    SELECT
      al.id AS album_id,
      al.name AS album_name,
      ar.name AS artist_name,
      al.cover_art_url,
      al.release_date,
      COUNT(DISTINCT lf.blake3_hash) AS file_count,
      MIN(lf.dr_score)   AS dr_min,
      MAX(lf.dr_score)   AS dr_max,
      ARRAY_AGG(DISTINCT lf.format) FILTER (WHERE lf.format IS NOT NULL) AS formats
    FROM albums al
    JOIN artists ar ON al.artist_id = ar.id
    JOIN songs s ON s.album_id = al.id
    JOIN library_files lf ON lf.song_id = s.id
    WHERE lf.blake3_hash IS NOT NULL
      AND al.id IN (
        SELECT s2.album_id
        FROM songs s2
        JOIN library_files lf2 ON lf2.song_id = s2.id
        WHERE lf2.blake3_hash IS NOT NULL
        GROUP BY s2.id
        HAVING COUNT(DISTINCT lf2.blake3_hash) > 1
      )
    GROUP BY al.id, al.name, ar.name, al.cover_art_url, al.release_date
    ORDER BY ar.name, al.release_date DESC NULLS LAST
  `
  return NextResponse.json(rows)
}
