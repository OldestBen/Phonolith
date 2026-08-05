export const dynamic = 'force-dynamic'

/**
 * Library-wide Galaxy data, artist-cluster granularity: one node per artist
 * that has at least one indexed song. This is the cheap/default mode — even
 * a very large personal library tops out at a few thousand artists, so
 * unlike the per-song endpoint (./songs/route.ts) this one doesn't need to
 * truncate anything to stay fast; the LIMIT below is a sanity ceiling, not
 * an expected truncation point.
 *
 * Nodes are keyed by `artists.id` (the internal DB id) for graph/edge
 * matching — same rule ArtistViz documents for songs.id — never by
 * `genius_id`. `genius_id` is only carried along to build the outbound link
 * into the existing real /visualize/[id] (per-artist) page, which is keyed
 * by genius_id (see /api/visualize/[id]/route.ts's `WHERE genius_id = ...`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

// Sanity ceiling, not a real-world truncation point — see module comment.
const ARTIST_LIMIT = 5000
// Cross-artist edge lists are capped defensively; a library with heavy
// featured-artist/producer overlap could otherwise return an unbounded
// number of pairs.
const EDGE_LIMIT = 3000

export interface GalaxyArtistNode {
  id: number
  genius_id: number
  name: string
  image_url: string | null
  /** Real COUNT of songs.id rows for this artist (Genius-sourced catalogue size). */
  song_count: number
  /** Real COUNT of library_files matched (via tracks) to one of this artist's
   *  songs — i.e. how much of this artist is actually owned, not just known. */
  owned_count: number
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const cacheKey = 'viz:galaxy:artists'
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  // song_count / owned_count are both real aggregates. owned_count follows
  // the real, live ownership path: library_files.song_id -> songs.artist_id,
  // set by the actual matching flow (POST /api/library/[hash]/match).
  // library_files.track_id -> tracks.song_id looked like it should be the
  // "modern" path given tracks.song_id's "Genius match" migration comment,
  // but nothing in this codebase ever writes tracks.song_id (checked
  // api/library/ingest/route.ts's tracks INSERT column list and grepped the
  // whole repo for writers) — it's always NULL, so joining through it would
  // silently report owned_count = 0 for every artist in every real library.
  const artistRows = await sql`
    SELECT
      a.id AS db_id,
      a.genius_id,
      a.name,
      a.image_url,
      COUNT(DISTINCT s.id)::int  AS song_count,
      COUNT(DISTINCT lf.id)::int AS owned_count
    FROM artists a
    JOIN songs s ON s.artist_id = a.id
    LEFT JOIN library_files lf ON lf.song_id = s.id
    WHERE a.genius_id IS NOT NULL
    GROUP BY a.id
    ORDER BY song_count DESC
    LIMIT ${ARTIST_LIMIT}
  `

  // Cross-artist edges: two artists connect if they share a real credit
  // (a featured artist or producer credited on songs by both). This is the
  // same collaborator/producer logic as /api/visualize/[id]/connections,
  // widened from "within one artist's songs" to "across the whole library."
  //
  // Deliberately no "era" edge at this granularity: the per-artist version
  // means "these two songs by the same artist were released within 2 years
  // of each other," which is a meaningful clustering signal. At library
  // scope the equivalent ("any two artists both active in the same 2-year
  // window") is true for nearly every pair of artists in a normal library —
  // it wouldn't be fabricated, but it also wouldn't carry any real signal,
  // so it's left out rather than drawn as a dense, meaningless hairball.
  const [collaboratorRows, producerRows] = await Promise.all([
    sql`
      SELECT DISTINCT s1.artist_id AS a, s2.artist_id AS b
      FROM credits c1
      JOIN credits c2 ON c1.name = c2.name AND c1.song_id <> c2.song_id
      JOIN songs s1 ON c1.song_id = s1.id
      JOIN songs s2 ON c2.song_id = s2.id
      WHERE c1.role IN ('Featured', 'featured')
        AND c2.role IN ('Featured', 'featured')
        AND s1.artist_id < s2.artist_id
      LIMIT ${EDGE_LIMIT}
    `,
    sql`
      SELECT DISTINCT s1.artist_id AS a, s2.artist_id AS b
      FROM credits c1
      JOIN credits c2 ON c1.name = c2.name AND c1.song_id <> c2.song_id
      JOIN songs s1 ON c1.song_id = s1.id
      JOIN songs s2 ON c2.song_id = s2.id
      WHERE c1.role IN ('Produced by', 'Producer', 'producer')
        AND c2.role IN ('Produced by', 'Producer', 'producer')
        AND s1.artist_id < s2.artist_id
      LIMIT ${EDGE_LIMIT}
    `,
  ])

  const artists: GalaxyArtistNode[] = artistRows.map(r => ({
    id: Number(r.db_id),
    genius_id: Number(r.genius_id),
    name: String(r.name),
    image_url: r.image_url ?? null,
    song_count: Number(r.song_count),
    owned_count: Number(r.owned_count),
  }))

  const result = {
    artists,
    edges: {
      collaborator: collaboratorRows.map(r => [Number(r.a), Number(r.b)] as [number, number]),
      producer: producerRows.map(r => [Number(r.a), Number(r.b)] as [number, number]),
    },
  }

  await rset(cacheKey, result, 3600)
  return NextResponse.json(result)
}
