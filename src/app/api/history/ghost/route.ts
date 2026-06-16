export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    SELECT
      s.id AS song_id,
      s.title,
      ar.name AS artist_name,
      MAX(h.created_at)::text AS last_event,
      EXTRACT(day FROM NOW() - MAX(h.created_at))::int AS days_since,
      lf.dr_score
    FROM songs s
    JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN history h ON h.song_id = s.id
    LEFT JOIN library_files lf ON lf.song_id = s.id
    GROUP BY s.id, s.title, ar.name, lf.dr_score
    HAVING MAX(h.created_at) IS NULL
        OR MAX(h.created_at) < NOW() - INTERVAL '365 days'
    ORDER BY last_event NULLS FIRST, days_since DESC NULLS FIRST
    LIMIT 100
  `

  return NextResponse.json(
    rows.map(r => ({
      song_id: Number(r.song_id),
      title: String(r.title),
      artist_name: String(r.artist_name),
      last_event: r.last_event ? String(r.last_event) : null,
      days_since: r.days_since != null ? Number(r.days_since) : null,
      dr_score: r.dr_score != null ? Number(r.dr_score) : null,
    }))
  )
}
