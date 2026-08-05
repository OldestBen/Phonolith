export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

/**
 * Single-album detail — the actual "album view" the Albums grid links to.
 * Uses the same canonical-id + normalized-text grouping as
 * /api/library/albums (see that route for why: raw `album`/`artist` tags
 * are inconsistent enough across real libraries that naive text equality
 * silently fragments one physical album into several).
 *
 * Accepts either:
 *   ?id=<albums.id>            — preferred, for albums matched via Genius/MB
 *   ?artist=<x>&album=<y>      — fallback for albums with no match at all;
 *                                 still folds in any files that ARE matched
 *                                 to a canonical album whose normalized
 *                                 name/artist equals the raw text, so a
 *                                 stale bookmark/link still resolves.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const idParam = req.nextUrl.searchParams.get('id')
  const artistParam = req.nextUrl.searchParams.get('artist')?.trim()
  const albumParam = req.nextUrl.searchParams.get('album')?.trim()
  const id = idParam ? parseInt(idParam, 10) : null

  if (!id && !(artistParam && albumParam)) {
    return NextResponse.json({ error: 'Provide either id, or both artist and album.' }, { status: 400 })
  }

  const rawKey = artistParam && albumParam
    ? `${albumParam.trim().toLowerCase()}::${artistParam.trim().toLowerCase()}`
    : null

  const rows = await sql`
    WITH canon AS (
      SELECT al.id AS album_id, al.name AS album_name, ar.name AS artist_name,
             lower(trim(al.name)) AS norm_album, lower(trim(ar.name)) AS norm_artist
      FROM albums al
      JOIN artists ar ON ar.id = al.artist_id
    ),
    keyed AS (
      SELECT
        lf.*, s.title AS song_title, ar2.name AS song_artist,
        COALESCE(t.track_number, lf.track_number) AS resolved_track_number,
        COALESCE(t.disc_number, lf.disc_number)   AS resolved_disc_number,
        COALESCE(s.album_id, c.album_id) AS resolved_album_id,
        lower(trim(COALESCE(lf.album, ''))) || '::' || lower(trim(COALESCE(lf.artist, ''))) AS raw_key
      FROM library_files lf
      LEFT JOIN songs s ON s.id = lf.song_id
      LEFT JOIN artists ar2 ON s.artist_id = ar2.id
      LEFT JOIN tracks t ON lf.track_id = t.id
      LEFT JOIN canon c
        ON c.norm_album = lower(trim(COALESCE(lf.album, '')))
       AND c.norm_artist = lower(trim(COALESCE(lf.artist, '')))
      WHERE lf.album IS NOT NULL
    )
    SELECT k.*
    FROM keyed k
    WHERE ${id ? sql`k.resolved_album_id = ${id}` : sql`(k.resolved_album_id IS NULL AND k.raw_key = ${rawKey})`}
    ORDER BY k.resolved_disc_number ASC NULLS LAST, k.resolved_track_number ASC NULLS LAST, k.title ASC
  `

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  }

  const canonRow = await (id
    ? sql`SELECT al.id AS album_id, al.name, al.cover_art_url, al.release_date, ar.name AS artist_name
          FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.id = ${id}`
    : Promise.resolve([]))

  const first = rows[0]
  const album = canonRow[0]?.name ?? first.album
  const artist = canonRow[0]?.artist_name ?? first.artist
  const year = rows.reduce((min: string | null, r) => {
    if (!r.year) return min
    return min === null || r.year < min ? r.year : min
  }, null as string | null)
  const coverFile = rows.find(r => r.cover_art_path) ?? first

  return NextResponse.json({
    album_id: id ?? null,
    album,
    artist,
    year,
    cover_hash: coverFile.blake3_hash,
    has_cover: rows.some(r => r.cover_art_path),
    files: rows.map(r => {
      const { resolved_track_number, resolved_disc_number, resolved_album_id, raw_key, ...file } = r
      void resolved_album_id
      void raw_key
      return { ...file, track_number: resolved_track_number, disc_number: resolved_disc_number }
    }),
  })
}
