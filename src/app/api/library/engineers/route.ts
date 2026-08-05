export const dynamic = 'force-dynamic'

/**
 * Mastering Engineer Matrix — ranks the `engineer` credit embedded in
 * library_files (ID3 TXXX:ENGINEER/TIPL/TMCL frames or the FLAC/Vorbis
 * `engineer` comment — see migrations/018_engineer_tag.sql) by average
 * DR score across the tracks credited to them.
 *
 * Deliberately NOT sourced from track_contributions/contributors (the
 * MusicBrainz-driven credit system from 012_tracks.sql) — that models a
 * different "engineer" role entirely and isn't populated the same way.
 *
 * "Lossless" here means format IN ('flac','wav','aiff','alac') — the same
 * set of container formats the /versions QualityTier logic treats as
 * lossless-capable (see src/app/versions/[albumId]/page.tsx).
 *
 * No peak/RMS or star-rating columns exist anywhere in the schema (checked
 * every migration), so unlike the original mockup this response has no
 * peak/RMS/rating fields — only real, queryable numbers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

const LOSSLESS_FORMATS = ['flac', 'wav', 'aiff', 'alac']

export interface EngineerStat {
  engineer: string
  file_count: number
  avg_dr: number | null
  pct_of_library: number
  lossless_count: number
  lossless_ratio: string
  verified_count: number
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    WITH totals AS (
      SELECT COUNT(*)::int AS total FROM library_files
    )
    SELECT
      lf.engineer,
      COUNT(*)::int AS file_count,
      AVG(lf.dr_score) AS avg_dr,
      COUNT(*) FILTER (WHERE lf.format IN ${sql(LOSSLESS_FORMATS)})::int AS lossless_count,
      COUNT(*) FILTER (WHERE lf.accuraterip_status = 'verified')::int AS verified_count,
      totals.total AS library_total
    FROM library_files lf, totals
    WHERE lf.engineer IS NOT NULL AND lf.engineer != ''
    GROUP BY lf.engineer, totals.total
    ORDER BY avg_dr DESC NULLS LAST, file_count DESC
  `

  const stats: EngineerStat[] = rows.map(r => {
    const fileCount = Number(r.file_count)
    const libraryTotal = Number(r.library_total)
    const lossless = Number(r.lossless_count)
    return {
      engineer: String(r.engineer),
      file_count: fileCount,
      avg_dr: r.avg_dr == null ? null : Number(r.avg_dr),
      pct_of_library: libraryTotal > 0 ? Math.round((fileCount / libraryTotal) * 1000) / 10 : 0,
      lossless_count: lossless,
      lossless_ratio: `${lossless}/${fileCount} lossless`,
      verified_count: Number(r.verified_count),
    }
  })

  return NextResponse.json(stats)
}
