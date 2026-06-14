export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { tag_id } = await req.json() as { tag_id: number }
  if (!tag_id) return NextResponse.json({ error: 'Missing tag_id' }, { status: 400 })

  const songRows = await sql`SELECT id FROM songs WHERE genius_id = ${id}`
  if (songRows.length === 0) return NextResponse.json({ error: 'Song not found' }, { status: 404 })

  await sql`
    INSERT INTO song_tags (song_id, tag_id)
    VALUES (${songRows[0].id}, ${tag_id})
    ON CONFLICT DO NOTHING
  `

  return NextResponse.json({ ok: true })
}
