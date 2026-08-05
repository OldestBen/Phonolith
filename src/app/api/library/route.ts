export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const q = params.get('q')?.trim() || null
  const format = params.get('format')
  const dr = params.get('dr') // high | mid | low
  const match = params.get('match') // matched | unmatched
  const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(parseInt(params.get('offset') ?? '', 10) || 0, 0)

  // Build the WHERE clause from whichever filters are actually present —
  // each is real SQL against real columns, composed rather than branched
  // per-combination (the old version only had a q/no-q branch and applied
  // format/DR/matched filters client-side against the *entire* table).
  const conditions = []
  if (format && format !== 'all') conditions.push(sql`lf.format = ${format}`)
  if (dr === 'high') conditions.push(sql`lf.dr_score > 12`)
  if (dr === 'mid') conditions.push(sql`lf.dr_score >= 8 AND lf.dr_score <= 12`)
  if (dr === 'low') conditions.push(sql`lf.dr_score IS NOT NULL AND lf.dr_score < 8`)
  if (match === 'matched') conditions.push(sql`lf.song_id IS NOT NULL`)
  if (match === 'unmatched') conditions.push(sql`lf.song_id IS NULL`)

  // Search: exact/prefix substring hits (ILIKE) rank first and are matched
  // against BOTH the raw embedded tags (lf.title/artist/album) AND the
  // resolved/canonical fields (s.title, ar.name) — the previous version only
  // checked raw tags, so searching for a canonically-matched artist name
  // that differs from what's embedded in the file's own tags returned
  // nothing. Trigram similarity is kept only as a typo-tolerant fallback,
  // and only above a threshold high enough to avoid the "random unrelated
  // results" fuzziness of Postgres's default 0.3 `%` operator threshold on
  // short strings.
  if (q) {
    const like = `%${q}%`
    conditions.push(sql`(
      lf.title ILIKE ${like} OR lf.artist ILIKE ${like} OR lf.album ILIKE ${like}
      OR s.title ILIKE ${like} OR ar.name ILIKE ${like}
      OR similarity(lf.title, ${q}) > 0.45
      OR similarity(lf.artist, ${q}) > 0.45
      OR similarity(lf.album, ${q}) > 0.45
      OR similarity(COALESCE(ar.name, ''), ${q}) > 0.45
    )`)
  }

  const where = conditions.length
    ? conditions.slice(1).reduce((acc, c) => sql`${acc} AND ${c}`, sql`WHERE ${conditions[0]}`)
    : sql``

  // Exact substring hits first, then trigram-similarity ranking, then
  // recency — so a search for "drake" surfaces literal matches before
  // fuzzy ones instead of an arbitrary similarity-only order.
  const orderBy = q
    ? sql`ORDER BY
        (lf.title ILIKE ${'%' + q + '%'} OR lf.artist ILIKE ${'%' + q + '%'} OR lf.album ILIKE ${'%' + q + '%'}
         OR s.title ILIKE ${'%' + q + '%'} OR ar.name ILIKE ${'%' + q + '%'}) DESC,
        GREATEST(
          similarity(lf.title, ${q}), similarity(lf.artist, ${q}), similarity(lf.album, ${q}),
          similarity(COALESCE(ar.name, ''), ${q})
        ) DESC,
        lf.indexed_at DESC`
    : sql`ORDER BY lf.indexed_at DESC`

  const [rows, countRows] = await Promise.all([
    sql`
      SELECT lf.*, s.title AS song_title, ar.name AS song_artist,
             COALESCE(t.track_number, lf.track_number) AS track_number,
             COALESCE(t.disc_number, lf.disc_number) AS disc_number
      FROM library_files lf
      LEFT JOIN songs s ON lf.song_id = s.id
      LEFT JOIN artists ar ON s.artist_id = ar.id
      LEFT JOIN tracks t ON lf.track_id = t.id
      ${where}
      ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM library_files lf
      LEFT JOIN songs s ON lf.song_id = s.id
      LEFT JOIN artists ar ON s.artist_id = ar.id
      ${where}
    `,
  ])

  return NextResponse.json({
    files: rows,
    total: countRows[0]?.total ?? rows.length,
    limit,
    offset,
  })
}
