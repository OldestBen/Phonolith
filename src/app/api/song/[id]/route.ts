export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { getSong, buildReleaseDate } from '@/lib/genius'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `song:${id}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  const rows = await sql`
    SELECT s.*, ar.name AS artist_name, al.name AS album_name, al.cover_art_url AS album_cover_art_url
    FROM songs s
    LEFT JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    WHERE s.genius_id = ${id}
  `

  if (rows.length > 0 && rows[0].description) {
    await rset(cacheKey, rows[0], 300)
    return NextResponse.json(rows[0])
  }

  try {
    const s = await getSong(id)
    const releaseDate = buildReleaseDate(s.release_date_components) ?? s.release_date ?? null

    // Ensure artist exists
    await sql`
      INSERT INTO artists (genius_id, name, image_url, fetched_at)
      VALUES (${s.primary_artist.id}, ${s.primary_artist.name}, ${s.primary_artist.image_url}, NOW())
      ON CONFLICT (genius_id) DO UPDATE SET name = EXCLUDED.name
    `
    const artistRows = await sql`SELECT id FROM artists WHERE genius_id = ${s.primary_artist.id}`
    const dbArtistId = artistRows[0]?.id

    let dbAlbumId: number | null = null
    if (s.album && dbArtistId) {
      const albumRows = await sql`
        INSERT INTO albums (genius_id, artist_id, name, cover_art_url,
                            release_date, fetched_at)
        VALUES (${s.album.id}, ${dbArtistId}, ${s.album.name}, ${s.album.cover_art_url},
                ${buildReleaseDate(s.album.release_date_components) ?? null}, NOW())
        ON CONFLICT (genius_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `
      dbAlbumId = albumRows[0]?.id ?? null
    }

    const songRows = await sql`
      INSERT INTO songs (genius_id, artist_id, album_id, title, full_title, path,
                         release_date, song_art_image_url, description, pageviews, fetched_at)
      VALUES (${s.id}, ${dbArtistId ?? null}, ${dbAlbumId ?? null}, ${s.title},
              ${s.full_title ?? null}, ${s.path ?? null}, ${releaseDate},
              ${s.song_art_image_url ?? null}, ${s.description ?? null},
              ${s.pageviews ?? null}, NOW())
      ON CONFLICT (genius_id) DO UPDATE
      SET description = EXCLUDED.description, pageviews = EXCLUDED.pageviews, fetched_at = NOW()
      RETURNING id
    `
    const dbSongId = songRows[0]?.id

    // Store credits
    if (dbSongId) {
      await sql`DELETE FROM credits WHERE song_id = ${dbSongId}`
      const creditEntries: Array<{ role: string; artists: Array<{ id: number; name: string }> }> = [
        { role: 'Featured', artists: s.featured_artists },
        { role: 'Produced by', artists: s.producer_artists },
        { role: 'Written by', artists: s.writer_artists },
        ...s.custom_performances.map(cp => ({ role: cp.label, artists: cp.artists })),
      ]
      for (const entry of creditEntries) {
        for (const artist of entry.artists) {
          await sql`
            INSERT INTO credits (song_id, role, name, genius_id)
            VALUES (${dbSongId}, ${entry.role}, ${artist.name}, ${artist.id})
          `
        }
      }
    }

    const result = {
      ...s,
      artist_name: s.primary_artist.name,
      album_name: s.album?.name,
      album_cover_art_url: s.album?.cover_art_url,
    }
    await rset(cacheKey, result, 300)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch song' }, { status: 502 })
  }
}
