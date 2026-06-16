export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { scrapeLyrics } from '@/lib/genius'
import { getLyrics as getLrclibLyrics } from '@/lib/lrclib'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `lyrics:${id}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  // DB cache
  const rows = await sql`
    SELECT l.*, s.path, s.artist_id
    FROM lyrics l
    JOIN songs s ON l.song_id = s.id
    WHERE s.genius_id = ${id}
  `
  if (rows.length > 0) {
    const result = {
      content: rows[0].content,
      synced_lyrics: rows[0].synced_lyrics ?? null,
      scraped_at: rows[0].scraped_at,
    }
    await rset(cacheKey, result, 600)
    return NextResponse.json(result)
  }

  const songRows = await sql`
    SELECT s.id, s.path, s.artist_id, s.title, s.full_title, ar.name AS artist_name, al.name AS album_name
    FROM songs s
    LEFT JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    WHERE s.genius_id = ${id}
  `
  if (songRows.length === 0) {
    return NextResponse.json({ error: 'Song not found — fetch /api/song/[id] first' }, { status: 404 })
  }

  const { id: dbSongId, path: songPath, artist_id, title, artist_name, album_name } = songRows[0]

  let content: string | null = null
  let syncedLyrics: string | null = null

  if (artist_name && title) {
    const trackRows = await sql`SELECT duration_ms FROM tracks WHERE song_id = ${dbSongId} LIMIT 1`
    const durationSec = trackRows[0]?.duration_ms ? Math.round(trackRows[0].duration_ms / 1000) : undefined

    const lrclibResult = await getLrclibLyrics(artist_name, title, album_name ?? undefined, durationSec)
    if (lrclibResult) {
      content = lrclibResult.plain
      syncedLyrics = lrclibResult.synced
    }
  }

  // LRCLIB has no match — fall back to Genius scraping as a lower-confidence source.
  if (!content) {
    if (!songPath) {
      return NextResponse.json({ error: 'No lyrics source available' }, { status: 404 })
    }
    try {
      content = await scrapeLyrics(songPath)
      console.warn(`[lyrics] song ${id}: LRCLIB had no match, used Genius scrape fallback (lower confidence)`)
    } catch {
      return NextResponse.json({ error: 'Failed to fetch lyrics' }, { status: 502 })
    }
  }

  await sql`
    INSERT INTO lyrics (song_id, content, synced_lyrics, scraped_at)
    VALUES (${dbSongId}, ${content}, ${syncedLyrics}, NOW())
    ON CONFLICT (song_id) DO UPDATE
    SET content = EXCLUDED.content, synced_lyrics = EXCLUDED.synced_lyrics, scraped_at = NOW()
  `

  await sql`
    INSERT INTO history (song_id, artist_id, event)
    VALUES (${dbSongId}, ${artist_id ?? null}, 'lyrics_read')
  `

  const result = { content, synced_lyrics: syncedLyrics, scraped_at: new Date().toISOString() }
  await rset(cacheKey, result, 600)
  return NextResponse.json(result)
}
