export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { groupFileVersions } from '@/lib/versions'

// Returns all library files for songs on this album — for version comparison
export async function GET(
  req: NextRequest,
  { params }: { params: { albumId: string } }
) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const albumId = parseInt(params.albumId)
  if (isNaN(albumId)) return NextResponse.json({ error: 'Invalid album ID' }, { status: 400 })

  const [album] = await sql`
    SELECT al.*, ar.name AS artist_name
    FROM albums al JOIN artists ar ON al.artist_id = ar.id
    WHERE al.id = ${albumId}
  `
  if (!album) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const files = await sql`
    SELECT
      lf.*,
      s.title AS song_title,
      s.release_date AS song_release_date
    FROM library_files lf
    JOIN songs s ON lf.song_id = s.id
    WHERE s.album_id = ${albumId}
    ORDER BY lf.track_number NULLS LAST, s.title
  `

  const versions = groupFileVersions(files)

  return NextResponse.json({ album, versions })
}
