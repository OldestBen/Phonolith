export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const artistId = parseInt(params.id)
  if (isNaN(artistId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const rows = await sql`
    SELECT h.*, s.title AS song_title, ar.name AS artist_name
    FROM history h
    LEFT JOIN songs s ON h.song_id = s.id
    LEFT JOIN artists ar ON h.artist_id = ar.id
    WHERE h.artist_id = (SELECT id FROM artists WHERE genius_id = ${artistId})
    ORDER BY h.created_at DESC
    LIMIT 100
  `

  return NextResponse.json(rows)
}
