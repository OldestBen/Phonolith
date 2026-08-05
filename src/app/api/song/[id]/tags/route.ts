export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const rows = await sql`
    SELECT t.id, t.name, t.color, t.created_at
    FROM song_tags st
    JOIN tags t ON t.id = st.tag_id
    JOIN songs s ON s.id = st.song_id
    WHERE s.genius_id = ${id}
    ORDER BY t.name
  `
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

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
