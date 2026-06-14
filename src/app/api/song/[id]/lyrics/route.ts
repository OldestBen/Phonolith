export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { scrapeLyrics } from '@/lib/genius'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `lyrics:${id}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  // Check DB
  const rows = await sql`
    SELECT l.*, s.path, s.artist_id
    FROM lyrics l
    JOIN songs s ON l.song_id = s.id
    WHERE s.genius_id = ${id}
  `
  if (rows.length > 0) {
    const result = { content: rows[0].content, scraped_at: rows[0].scraped_at }
    await rset(cacheKey, result, 600)
    return NextResponse.json(result)
  }

  // Need song path to scrape
  const songRows = await sql`SELECT id, path, artist_id FROM songs WHERE genius_id = ${id}`
  if (songRows.length === 0) {
    return NextResponse.json({ error: 'Song not found — fetch /api/song/[id] first' }, { status: 404 })
  }

  const { id: dbSongId, path: songPath, artist_id } = songRows[0]

  if (!songPath) {
    return NextResponse.json({ error: 'No Genius path available' }, { status: 404 })
  }

  try {
    const content = await scrapeLyrics(songPath)

    await sql`
      INSERT INTO lyrics (song_id, content, scraped_at)
      VALUES (${dbSongId}, ${content}, NOW())
      ON CONFLICT (song_id) DO UPDATE
      SET content = EXCLUDED.content, scraped_at = NOW()
    `

    // Record history event
    await sql`
      INSERT INTO history (song_id, artist_id, event)
      VALUES (${dbSongId}, ${artist_id ?? null}, 'lyrics_read')
    `

    const result = { content, scraped_at: new Date().toISOString() }
    await rset(cacheKey, result, 600)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to scrape lyrics' }, { status: 502 })
  }
}
