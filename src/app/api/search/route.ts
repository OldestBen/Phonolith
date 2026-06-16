export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { searchArtists } from '@/lib/genius'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')
  if (!q?.trim()) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  const cacheKey = `search:${q.toLowerCase().trim()}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const artists = await searchArtists(q)

    // Cache artist stubs in DB
    for (const a of artists) {
      await sql`
        INSERT INTO artists (genius_id, name, image_url, fetched_at)
        VALUES (${a.id}, ${a.name}, ${a.image_url}, NOW())
        ON CONFLICT (genius_id) DO UPDATE
        SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
      `
    }

    await rset(cacheKey, artists, 300)
    return NextResponse.json(artists)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('GENIUS_ACCESS_TOKEN')) {
      return NextResponse.json({ error: 'Genius API token not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Search failed' }, { status: 502 })
  }
}
