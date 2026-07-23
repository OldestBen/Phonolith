export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

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

  type FileRow = (typeof files)[number]
  // Group by a "version signature" — unique combination of format+bit_depth+sample_rate
  const signatureMap = new Map<string, FileRow[]>()
  for (const f of files) {
    const sig = [f.format, f.bit_depth, f.sample_rate].filter(Boolean).join('/')
    const key = sig || 'unknown'
    if (!signatureMap.has(key)) signatureMap.set(key, [])
    signatureMap.get(key)!.push(f)
  }

  const versions = Array.from(signatureMap.entries()).map(([sig, tracks]) => {
    const drScores = tracks.map((t: { dr_score?: number | null }) => t.dr_score).filter((d): d is number => d != null)
    const avgDr = drScores.length ? drScores.reduce((a, b) => a + b, 0) / drScores.length : null
    const sample = tracks[0]
    return {
      signature: sig,
      format: sample.format,
      bit_depth: sample.bit_depth,
      sample_rate: sample.sample_rate,
      bitrate: sample.bitrate,
      dr_avg: avgDr ? Math.round(avgDr * 10) / 10 : null,
      dr_scores: drScores,
      spectral_ok: tracks.every((t: { spectral_ok?: boolean | null }) => t.spectral_ok),
      accuraterip_status: sample.accuraterip_status,
      track_count: tracks.length,
      tracks,
    }
  }).sort((a, b) => {
    // Sort by quality: prefer higher DR, then higher bit depth, then higher sample rate
    const drDiff = (b.dr_avg ?? 0) - (a.dr_avg ?? 0)
    if (drDiff !== 0) return drDiff
    const bdDiff = (b.bit_depth ?? 0) - (a.bit_depth ?? 0)
    if (bdDiff !== 0) return bdDiff
    return (b.sample_rate ?? 0) - (a.sample_rate ?? 0)
  })

  return NextResponse.json({ album, versions })
}
