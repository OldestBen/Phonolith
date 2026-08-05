export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function DELETE(req: NextRequest, { params }: { params: { id: string; tagId: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

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
