export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getArtist } from '@/lib/genius'
import { searchArtist } from '@/lib/musicbrainz'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `artist:${id}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  // Check DB first
  const rows = await sql`SELECT * FROM artists WHERE genius_id = ${id}`
  if (rows.length > 0 && rows[0].description) {
    await rset(cacheKey, rows[0], 300)
    return NextResponse.json(rows[0])
  }

  try {
    const a = await getArtist(id)

    // Try to enrich with MusicBrainz MBID asynchronously
    let mbId: string | null = null
    try {
      const mbArtist = await searchArtist(a.name)
      mbId = mbArtist?.id ?? null
    } catch {
      // Non-fatal
    }

    await sql`
      INSERT INTO artists (genius_id, name, image_url, description, followers, mb_id, fetched_at)
      VALUES (${a.id}, ${a.name}, ${a.image_url}, ${a.description ?? null}, ${a.followers_count ?? null}, ${mbId ?? null}::uuid, NOW())
      ON CONFLICT (genius_id) DO UPDATE
      SET name = EXCLUDED.name,
          image_url = EXCLUDED.image_url,
          description = EXCLUDED.description,
          followers = EXCLUDED.followers,
          mb_id = EXCLUDED.mb_id,
          fetched_at = NOW()
    `

    const result = { ...a, mb_id: mbId }
    await rset(cacheKey, result, 300)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch artist' }, { status: 502 })
  }
}
