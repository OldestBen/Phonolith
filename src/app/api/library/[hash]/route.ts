export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME, verifyInternalServiceToken } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { hash: string } }) {
  // Accept either a browser session (Library UI) or the internal service token
  // (Lucid fetching a file's location to stream it).
  const internal = verifyInternalServiceToken(req.headers.get('x-internal-token'))
  const user = internal ? null : await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!internal && !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    SELECT lf.*, s.title AS song_title, ar.name AS song_artist, s.genius_id AS song_genius_id, t.track_number
    FROM library_files lf
    LEFT JOIN songs s ON lf.song_id = s.id
    LEFT JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN tracks t ON lf.track_id = t.id
    WHERE lf.blake3_hash = ${params.hash}
  `
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}
