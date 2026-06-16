export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const artistId = parseInt(params.id)
  if (isNaN(artistId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `viz:${artistId}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  const songs = await sql`
    SELECT s.id, s.genius_id, s.title, s.release_date, s.pageviews,
           s.song_art_image_url, al.id AS album_db_id, al.genius_id AS album_genius_id,
           al.name AS album_name, al.cover_art_url AS album_cover_art_url
    FROM songs s
    LEFT JOIN albums al ON s.album_id = al.id
    WHERE s.artist_id = (SELECT id FROM artists WHERE genius_id = ${artistId})
    ORDER BY s.release_date NULLS LAST
  `

  await rset(cacheKey, songs, 3600)
  return NextResponse.json(songs)
}
