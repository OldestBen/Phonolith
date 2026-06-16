export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()

  const rows = q
    ? await sql`
        SELECT
          COALESCE(album, 'Unknown Album')   AS album,
          COALESCE(artist, 'Unknown Artist') AS artist,
          MIN(year)                          AS year,
          COUNT(*)::int                      AS track_count,
          (ARRAY_AGG(blake3_hash ORDER BY cover_art_path NULLS LAST))[1] AS cover_hash,
          BOOL_OR(cover_art_path IS NOT NULL) AS has_cover
        FROM library_files
        WHERE album IS NOT NULL
          AND (album ILIKE ${'%' + q + '%'} OR artist ILIKE ${'%' + q + '%'})
        GROUP BY album, artist
        ORDER BY album ASC
      `
    : await sql`
        SELECT
          COALESCE(album, 'Unknown Album')   AS album,
          COALESCE(artist, 'Unknown Artist') AS artist,
          MIN(year)                          AS year,
          COUNT(*)::int                      AS track_count,
          (ARRAY_AGG(blake3_hash ORDER BY cover_art_path NULLS LAST))[1] AS cover_hash,
          BOOL_OR(cover_art_path IS NOT NULL) AS has_cover
        FROM library_files
        WHERE album IS NOT NULL
        GROUP BY album, artist
        ORDER BY album ASC
      `

  return NextResponse.json(rows)
}
