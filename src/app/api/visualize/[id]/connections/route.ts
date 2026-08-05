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

  const cacheKey = `viz:connections:${artistId}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  const dbArtistRows = await sql`SELECT id FROM artists WHERE genius_id = ${artistId}`
  if (dbArtistRows.length === 0) return NextResponse.json({ collaborator: [], producer: [], era: [] })

  const dbArtistId = dbArtistRows[0].id

  // Collaborator connections: songs sharing a featured artist
  const collaboratorRows = await sql`
    SELECT DISTINCT c1.song_id AS song_a, c2.song_id AS song_b
    FROM credits c1
    JOIN credits c2 ON c1.name = c2.name AND c1.song_id < c2.song_id
    WHERE c1.role IN ('Featured', 'featured')
      AND c2.role IN ('Featured', 'featured')
      AND c1.song_id IN (SELECT id FROM songs WHERE artist_id = ${dbArtistId})
      AND c2.song_id IN (SELECT id FROM songs WHERE artist_id = ${dbArtistId})
    LIMIT 500
  `

  // Producer connections
  const producerRows = await sql`
    SELECT DISTINCT c1.song_id AS song_a, c2.song_id AS song_b
    FROM credits c1
    JOIN credits c2 ON c1.name = c2.name AND c1.song_id < c2.song_id
    WHERE c1.role IN ('Produced by', 'Producer', 'producer')
      AND c2.role IN ('Produced by', 'Producer', 'producer')
      AND c1.song_id IN (SELECT id FROM songs WHERE artist_id = ${dbArtistId})
      AND c2.song_id IN (SELECT id FROM songs WHERE artist_id = ${dbArtistId})
    LIMIT 500
  `

  // Era connections: songs within 2 years of each other
  const eraRows = await sql`
    SELECT s1.id AS song_a, s2.id AS song_b
    FROM songs s1
    JOIN songs s2 ON s1.id < s2.id
    WHERE s1.artist_id = ${dbArtistId}
      AND s2.artist_id = ${dbArtistId}
      AND s1.release_date IS NOT NULL
      AND s2.release_date IS NOT NULL
      AND ABS(EXTRACT(YEAR FROM s1.release_date) - EXTRACT(YEAR FROM s2.release_date)) <= 2
    LIMIT 500
  `

  const result = {
    collaborator: collaboratorRows.map(r => [r.song_a, r.song_b]),
    producer: producerRows.map(r => [r.song_a, r.song_b]),
    era: eraRows.map(r => [r.song_a, r.song_b]),
  }

  await rset(cacheKey, result, 3600)
  return NextResponse.json(result)
}
