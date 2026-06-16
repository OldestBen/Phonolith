export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const [readsPerWeekRows, topArtistsRows, totalEventsRows, totalArtistsRows, totalSongsRows] =
    await Promise.all([
      sql`
        SELECT
          date_trunc('week', created_at)::date AS week,
          COUNT(*) AS count
        FROM history
        WHERE created_at > NOW() - INTERVAL '12 weeks'
        GROUP BY 1
        ORDER BY 1
      `,
      sql`
        SELECT ar.id AS artist_id, ar.name, ar.image_url, COUNT(*) AS count
        FROM history h
        JOIN songs s ON h.song_id = s.id
        JOIN artists ar ON s.artist_id = ar.id
        WHERE h.created_at > NOW() - INTERVAL '90 days'
        GROUP BY ar.id, ar.name, ar.image_url
        ORDER BY count DESC
        LIMIT 10
      `,
      sql`SELECT COUNT(*) AS total FROM history`,
      sql`SELECT COUNT(DISTINCT artist_id) AS total FROM history WHERE artist_id IS NOT NULL`,
      sql`SELECT COUNT(DISTINCT song_id) AS total FROM history WHERE song_id IS NOT NULL`,
    ])

  return NextResponse.json({
    reads_per_week: readsPerWeekRows.map(r => ({
      week: String(r.week),
      count: Number(r.count),
    })),
    top_artists: topArtistsRows.map(r => ({
      artist_id: Number(r.artist_id),
      name: String(r.name),
      image_url: r.image_url ? String(r.image_url) : null,
      count: Number(r.count),
    })),
    total_events: Number(totalEventsRows[0]?.total ?? 0),
    total_artists: Number(totalArtistsRows[0]?.total ?? 0),
    total_songs: Number(totalSongsRows[0]?.total ?? 0),
  })
}
