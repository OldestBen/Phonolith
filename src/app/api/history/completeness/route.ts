export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    SELECT
      ar.id AS artist_id,
      ar.name,
      ar.image_url,
      COUNT(DISTINCT s.id) AS total_songs,
      COUNT(DISTINCT lf.song_id) AS library_songs,
      ROUND(COUNT(DISTINCT lf.song_id)::numeric / NULLIF(COUNT(DISTINCT s.id), 0) * 100, 0) AS pct
    FROM artists ar
    JOIN songs s ON s.artist_id = ar.id
    LEFT JOIN library_files lf ON lf.song_id = s.id
    WHERE ar.id IN (
      SELECT DISTINCT ar2.id FROM history h
      JOIN songs s2 ON h.song_id = s2.id
      JOIN artists ar2 ON s2.artist_id = ar2.id
    )
    GROUP BY ar.id, ar.name, ar.image_url
    HAVING COUNT(DISTINCT s.id) > 0
    ORDER BY pct ASC, total_songs DESC
    LIMIT 20
  `

  return NextResponse.json(
    rows.map(r => ({
      artist_id: Number(r.artist_id),
      name: String(r.name),
      image_url: r.image_url ? String(r.image_url) : null,
      total_songs: Number(r.total_songs),
      library_songs: Number(r.library_songs),
      pct: Number(r.pct ?? 0),
    }))
  )
}
