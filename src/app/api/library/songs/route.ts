export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/**
 * One row per matched song (songs.id), not one row per file — the "clean"
 * library view, complementing /api/library's raw per-file listing. A song
 * with 3 duplicate rips still shows once here, represented by its best
 * underlying file (preferred flag first, then DR score, then bit depth),
 * with a real file_count so the UI can say "3 versions" rather than hiding
 * the duplication.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const q = params.get('q')?.trim() || null
  const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(parseInt(params.get('offset') ?? '', 10) || 0, 0)

  const searchCondition = q
    ? sql`WHERE (s.title ILIKE ${'%' + q + '%'} OR ar.name ILIKE ${'%' + q + '%'} OR al.name ILIKE ${'%' + q + '%'})`
    : sql``

  const [rows, countRows] = await Promise.all([
    sql`
      WITH ranked AS (
        SELECT
          s.id AS song_id, s.title AS song_title, s.release_date,
          ar.name AS artist_name, al.id AS album_id, al.name AS album_name,
          lf.blake3_hash, lf.format, lf.dr_score, lf.bit_depth, lf.sample_rate,
          lf.duration_ms, lf.spectral_ok, lf.is_preferred,
          COUNT(*) OVER (PARTITION BY s.id) AS file_count,
          ROW_NUMBER() OVER (
            PARTITION BY s.id
            ORDER BY lf.is_preferred DESC, lf.dr_score DESC NULLS LAST, lf.bit_depth DESC NULLS LAST
          ) AS rn
        FROM songs s
        JOIN artists ar ON ar.id = s.artist_id
        LEFT JOIN albums al ON al.id = s.album_id
        JOIN library_files lf ON lf.song_id = s.id
        ${searchCondition}
      )
      SELECT * FROM ranked
      WHERE rn = 1
      ORDER BY artist_name ASC, album_name ASC NULLS LAST, song_title ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(DISTINCT s.id)::int AS total
      FROM songs s
      JOIN artists ar ON ar.id = s.artist_id
      LEFT JOIN albums al ON al.id = s.album_id
      JOIN library_files lf ON lf.song_id = s.id
      ${searchCondition}
    `,
  ])

  return NextResponse.json({
    songs: rows.map(r => {
      const { rn, ...rest } = r
      void rn
      return rest
    }),
    total: countRows[0]?.total ?? rows.length,
    limit,
    offset,
  })
}
