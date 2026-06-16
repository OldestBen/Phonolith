export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()

  const rows = q
    ? await sql`
        SELECT lf.*, s.title AS song_title, ar.name AS song_artist, t.track_number
        FROM library_files lf
        LEFT JOIN songs s ON lf.song_id = s.id
        LEFT JOIN artists ar ON s.artist_id = ar.id
        LEFT JOIN tracks t ON lf.track_id = t.id
        WHERE lf.title % ${q} OR lf.artist % ${q} OR lf.album % ${q}
        ORDER BY GREATEST(
          similarity(lf.title, ${q}),
          similarity(lf.artist, ${q}),
          similarity(lf.album, ${q})
        ) DESC
      `
    : await sql`
        SELECT lf.*, s.title AS song_title, ar.name AS song_artist, t.track_number
        FROM library_files lf
        LEFT JOIN songs s ON lf.song_id = s.id
        LEFT JOIN artists ar ON s.artist_id = ar.id
        LEFT JOIN tracks t ON lf.track_id = t.id
        ORDER BY lf.indexed_at DESC
      `
  return NextResponse.json(rows)
}
