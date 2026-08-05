export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { versionSignature } from '@/lib/versions'

// PATCH /api/versions/[albumId]/preferred
// Body: { signature: string }
// Marks every library_files row whose format/bit_depth/sample_rate signature
// matches `signature` as the preferred version for this album, and clears
// the flag on every other file on the album — so at most one version is
// preferred at a time. Signature must match what groupFileVersions/
// versionSignature() would compute for those rows.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { albumId: string } }
) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const albumId = parseInt(params.albumId)
  if (isNaN(albumId)) return NextResponse.json({ error: 'Invalid album ID' }, { status: 400 })

  const body = await req.json().catch(() => null) as { signature?: unknown } | null
  const signature = body?.signature
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'signature is required' }, { status: 400 })
  }

  const files = await sql<{ id: number; format: string | null; bit_depth: number | null; sample_rate: number | null }[]>`
    SELECT lf.id, lf.format, lf.bit_depth, lf.sample_rate
    FROM library_files lf
    JOIN songs s ON lf.song_id = s.id
    WHERE s.album_id = ${albumId}
  `

  const matchIds = files
    .filter(f => versionSignature(f) === signature)
    .map(f => f.id)

  if (matchIds.length === 0) {
    return NextResponse.json({ error: 'No files on this album match that version signature' }, { status: 404 })
  }

  await sql`
    UPDATE library_files lf
    SET is_preferred = (lf.id = ANY(${matchIds}))
    FROM songs s
    WHERE lf.song_id = s.id AND s.album_id = ${albumId}
  `

  return NextResponse.json({ ok: true, preferred_file_count: matchIds.length })
}
