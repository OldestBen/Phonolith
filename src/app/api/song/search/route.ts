export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * GET /api/song/search?q=<string>
 *
 * Searches songs already known to this instance (i.e. present in the local
 * `songs` table because some page previously fetched/ingested them). This is
 * NOT a live Genius search — there is no external API call here, only a
 * local ILIKE match against song title / artist name. It exists so the
 * standalone /lyrics reader (a new top-level destination, not reached by
 * drilling into an artist first) has some way to find a song to open.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')
  if (!q?.trim()) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  const like = `%${q.trim()}%`

  const rows = await sql`
    SELECT s.id, s.genius_id, s.title, ar.name AS artist_name, al.name AS album_name
    FROM songs s
    JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    WHERE s.title ILIKE ${like} OR ar.name ILIKE ${like}
    ORDER BY s.pageviews DESC NULLS LAST
    LIMIT 20
  `

  return NextResponse.json(rows)
}
