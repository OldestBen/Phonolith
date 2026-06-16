export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

// Returns all albums that have multiple library files — version comparison candidates
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
    GROUP BY al.id, al.name, ar.name, al.cover_art_url, al.release_date
    HAVING COUNT(DISTINCT lf.blake3_hash) > 1
    ORDER BY ar.name, al.release_date DESC NULLS LAST
  `
  return NextResponse.json(rows)
}
