export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET(req: NextRequest) {
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
