export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; tagId: string } }) {
  const songGeniusId = parseInt(params.id)
  const tagId = parseInt(params.tagId)
  if (isNaN(songGeniusId) || isNaN(tagId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const songRows = await sql`SELECT id FROM songs WHERE genius_id = ${songGeniusId}`
  if (songRows.length === 0) return NextResponse.json({ error: 'Song not found' }, { status: 404 })

  await sql`DELETE FROM song_tags WHERE song_id = ${songRows[0].id} AND tag_id = ${tagId}`
  return NextResponse.json({ ok: true })
}
