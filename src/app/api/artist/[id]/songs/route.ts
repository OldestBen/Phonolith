export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getAllSongs, buildReleaseDate } from '@/lib/genius'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const artistId = parseInt(params.id)
  if (isNaN(artistId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const fetchAll = req.nextUrl.searchParams.get('all') === 'true'
  const cacheKey = `artist:${artistId}:songs:${fetchAll ? 'all' : 'partial'}`

  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  // Check DB — if we have songs for this artist, return them
  const dbRows = await sql`
    SELECT s.*, a.name AS album_name, a.cover_art_url AS album_cover_art_url
    FROM songs s
    LEFT JOIN albums a ON s.album_id = a.id
    WHERE s.artist_id = (SELECT id FROM artists WHERE genius_id = ${artistId})
    ORDER BY s.release_date DESC NULLS LAST, s.id
  `

  if (dbRows.length > 0) {
    await rset(cacheKey, dbRows, 300)
    return NextResponse.json(dbRows)
  }

  try {
    const songs = await getAllSongs(artistId)

    // Get or create artist DB row
    const artistRows = await sql`SELECT id FROM artists WHERE genius_id = ${artistId}`
    const dbArtistId = artistRows[0]?.id

    if (dbArtistId) {
      for (const s of songs) {
        // Upsert album if present
        let dbAlbumId: number | null = null
        if (s.album) {
          const albumRows = await sql`
            INSERT INTO albums (genius_id, artist_id, name, cover_art_url, release_date, fetched_at)
            VALUES (${s.album.id}, ${dbArtistId}, ${s.album.name}, ${s.album.cover_art_url},
                    ${buildReleaseDate(s.album.release_date_components) ?? null}, NOW())
            ON CONFLICT (genius_id) DO UPDATE
            SET name = EXCLUDED.name, cover_art_url = EXCLUDED.cover_art_url
            RETURNING id
          `
          dbAlbumId = albumRows[0]?.id ?? null
        }

        const releaseDate = buildReleaseDate(s.release_date_components) ?? s.release_date ?? null

        await sql`
          INSERT INTO songs (genius_id, artist_id, album_id, title, full_title, path,
                             release_date, song_art_image_url, pageviews, fetched_at)
          VALUES (${s.id}, ${dbArtistId}, ${dbAlbumId ?? null}, ${s.title}, ${s.full_title ?? null},
                  ${s.path ?? null}, ${releaseDate}, ${s.song_art_image_url ?? null},
                  ${s.pageviews ?? null}, NOW())
          ON CONFLICT (genius_id) DO UPDATE
          SET title = EXCLUDED.title, album_id = EXCLUDED.album_id,
              release_date = EXCLUDED.release_date, fetched_at = NOW()
        `
      }
    }

    await rset(cacheKey, songs, 300)
    return NextResponse.json(songs)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch songs' }, { status: 502 })
  }
}
