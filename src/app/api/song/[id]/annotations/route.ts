export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `annotations:${id}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  const rows = await sql`
    SELECT a.id, a.fragment, a.body, a.source, a.created_at
    FROM annotations a
    JOIN songs s ON a.song_id = s.id
    WHERE s.genius_id = ${id}
    ORDER BY a.id
  `

  await rset(cacheKey, rows, 300)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { fragment, body } = await req.json() as { fragment: string; body: string }
  if (!fragment || !body) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const songRows = await sql`SELECT id FROM songs WHERE genius_id = ${id}`
  if (songRows.length === 0) return NextResponse.json({ error: 'Song not found' }, { status: 404 })

  const rows = await sql`
    INSERT INTO annotations (song_id, fragment, body, source)
    VALUES (${songRows[0].id}, ${fragment}, ${body}, 'user')
    RETURNING *
  `

  return NextResponse.json(rows[0], { status: 201 })
}
