export const dynamic = 'force-dynamic'

/**
 * Library-wide Galaxy data, per-song granularity: every song as its own
 * node, matching the mockup's literal "one node per song" description.
 *
 * This is the expensive mode. A real library can have tens of thousands of
 * songs, and a naive "return everything" here would (a) make this query
 * scan/join the full songs and credits tables on every request, and (b)
 * hand the client enough nodes to lock up an O(n²) force-layout pass in the
 * browser (see LibraryGalaxy.tsx). So this endpoint caps at SONG_LIMIT real
 * rows, chosen by real listen data (most-played first via pageviews) rather
 * than an arbitrary DB order, and reports the true total alongside the
 * capped list so the UI can say exactly what it's not showing instead of
 * truncating silently. `console.log` below documents the choice at request
 * time for the same reason.
 *
 * Nodes are keyed by `songs.id` (never `genius_id`) — same rule as
 * ArtistViz. `genius_id` is only used to build the outbound link to the
 * real /song/[id] page, which is keyed by genius_id (see
 * /api/song/[id]/route.ts's `WHERE s.genius_id = ...`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

// Bounds the force-layout node count. Chosen to keep the client's grid-
// partitioned settle pass (see LibraryGalaxy.tsx) comfortably fast — see
// that file's SONG_NODE_CAP comment for the perf reasoning in full.
const SONG_LIMIT = 2000
// Edge lists are computed only among the returned (capped) song set, so
// these limits are a secondary defensive ceiling, not the primary cost
// control — the primary control is scoping the credits/songs self-joins to
// `= ANY(ids)` over at most SONG_LIMIT ids.
const EDGE_LIMIT = 4000

export interface LibrarySongNode {
  id: number
  genius_id: number
  title: string
  release_date?: string
  pageviews?: number
  album_db_id?: number
  album_name?: string
  artist_db_id: number
  artist_genius_id: number
  artist_name: string
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const cacheKey = 'viz:galaxy:songs'
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  const [totalRows, songRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS total FROM songs WHERE genius_id IS NOT NULL`,
    sql`
      SELECT
        s.id, s.genius_id, s.title, s.release_date, s.pageviews,
        al.id AS album_db_id, al.name AS album_name,
        ar.id AS artist_db_id, ar.genius_id AS artist_genius_id, ar.name AS artist_name
      FROM songs s
      JOIN artists ar ON s.artist_id = ar.id
      LEFT JOIN albums al ON s.album_id = al.id
      WHERE s.genius_id IS NOT NULL
      ORDER BY s.pageviews DESC NULLS LAST, s.id ASC
      LIMIT ${SONG_LIMIT}
    `,
  ])

  const totalSongCount = Number(totalRows[0]?.total ?? 0)

  console.log(
    `[api/visualize/galaxy/songs] returning ${songRows.length} of ${totalSongCount} real songs ` +
    `(capped at SONG_LIMIT=${SONG_LIMIT}, ranked by pageviews) to keep the client-side force layout responsive`
  )

  const ids = songRows.map(r => Number(r.id))

  // `= ANY(${ids})` with an empty array is valid SQL (matches nothing), so
  // these can run unconditionally rather than branching on ids.length —
  // when the capped song set is empty there's nothing to match anyway.
  const [collaboratorRows, producerRows, eraRows] = await Promise.all([
    sql`
      SELECT DISTINCT c1.song_id AS song_a, c2.song_id AS song_b
      FROM credits c1
      JOIN credits c2 ON c1.name = c2.name AND c1.song_id < c2.song_id
      WHERE c1.role IN ('Featured', 'featured')
        AND c2.role IN ('Featured', 'featured')
        AND c1.song_id = ANY(${ids})
        AND c2.song_id = ANY(${ids})
      LIMIT ${EDGE_LIMIT}
    `,
    sql`
      SELECT DISTINCT c1.song_id AS song_a, c2.song_id AS song_b
      FROM credits c1
      JOIN credits c2 ON c1.name = c2.name AND c1.song_id < c2.song_id
      WHERE c1.role IN ('Produced by', 'Producer', 'producer')
        AND c2.role IN ('Produced by', 'Producer', 'producer')
        AND c1.song_id = ANY(${ids})
        AND c2.song_id = ANY(${ids})
      LIMIT ${EDGE_LIMIT}
    `,
    sql`
      SELECT s1.id AS song_a, s2.id AS song_b
      FROM songs s1
      JOIN songs s2 ON s1.id < s2.id
      WHERE s1.id = ANY(${ids})
        AND s2.id = ANY(${ids})
        AND s1.release_date IS NOT NULL
        AND s2.release_date IS NOT NULL
        AND ABS(EXTRACT(YEAR FROM s1.release_date) - EXTRACT(YEAR FROM s2.release_date)) <= 2
      LIMIT ${EDGE_LIMIT}
    `,
  ])

  const songs: LibrarySongNode[] = songRows.map(r => ({
    id: Number(r.id),
    genius_id: Number(r.genius_id),
    title: String(r.title),
    release_date: r.release_date ?? undefined,
    pageviews: r.pageviews ?? undefined,
    album_db_id: r.album_db_id ?? undefined,
    album_name: r.album_name ?? undefined,
    artist_db_id: Number(r.artist_db_id),
    artist_genius_id: Number(r.artist_genius_id),
    artist_name: String(r.artist_name),
  }))

  const result = {
    songs,
    edges: {
      collaborator: collaboratorRows.map(r => [Number(r.song_a), Number(r.song_b)] as [number, number]),
      producer: producerRows.map(r => [Number(r.song_a), Number(r.song_b)] as [number, number]),
      era: eraRows.map(r => [Number(r.song_a), Number(r.song_b)] as [number, number]),
    },
    total_song_count: totalSongCount,
    limit: SONG_LIMIT,
  }

  await rset(cacheKey, result, 3600)
  return NextResponse.json(result)
}
