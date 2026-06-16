export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'
import { searchRelease, getRelease, type DiscogsReleaseDetail } from '@/lib/discogs'

export async function GET(_req: NextRequest, { params }: { params: { hash: string } }) {
  const fileRows = await sql`
    SELECT artist, album, year FROM library_files WHERE blake3_hash = ${params.hash}
  `
  if (fileRows.length === 0) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const file = fileRows[0]
  if (!file.artist || !file.album) {
    return NextResponse.json({ error: 'Missing artist/album metadata for this file' }, { status: 400 })
  }

  const cacheKey = `discogs:pressing:${params.hash}`
  const cached = await rget<DiscogsReleaseDetail>(cacheKey)
  if (cached) return NextResponse.json({ pressing: cached })

  if (!process.env.DISCOGS_USER_TOKEN) {
    return NextResponse.json({ error: 'DISCOGS_USER_TOKEN not set' }, { status: 500 })
  }

  const results = await searchRelease(file.artist, file.album, file.year ?? undefined)
  if (!results || results.length === 0) {
    return NextResponse.json({ pressing: null })
  }

  // First result is Discogs' own relevance-ranked best match
  const best = results[0]
  const detail = await getRelease(best.id)
  if (!detail) return NextResponse.json({ error: 'Discogs lookup failed' }, { status: 502 })

  await rset(cacheKey, detail, 86400)

  return NextResponse.json({ pressing: detail })
}
