export const dynamic = 'force-dynamic'

import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { triggerScan } from '@/lib/analyst'

// The soulcatcher-downloads directory is mounted into the analyst container's
// /music tree (docker-compose.yml: soulcatcher_downloads volume on both slskd
// and analyst), so the analyst's existing recursive scanner already walks it
// as part of a normal library scan — no separate ingestion pipeline is needed,
// just a rescan. See docker-compose.yml's analyst.volumes comment.
const SOULCATCHER_LIBRARY_SUBPATH = '/music/soulcatcher-downloads'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid download id.' }, { status: 400 })
  }

  const rows = await sql`
    SELECT * FROM soulcatcher_downloads WHERE id = ${id}
  `
  const download = rows[0]
  if (!download) {
    return NextResponse.json({ error: 'Download not found.' }, { status: 404 })
  }
  if (download.status !== 'completed') {
    return NextResponse.json({ error: 'Download is not completed yet.' }, { status: 409 })
  }

  try {
    await triggerScan(SOULCATCHER_LIBRARY_SUBPATH)
  } catch {
    return NextResponse.json({ error: 'Analyst sidecar unavailable.' }, { status: 502 })
  }

  // download.filename comes from the remote Soulseek peer's file listing and
  // is untrusted — path.basename() strips both '/' and '\' separators so a
  // crafted "../../etc/passwd"-style name can't make local_path point
  // outside SOULCATCHER_LIBRARY_SUBPATH.
  const safeName = path.basename(download.filename.replace(/\\/g, '/'))
  await sql`
    UPDATE soulcatcher_downloads
    SET local_path = ${SOULCATCHER_LIBRARY_SUBPATH + '/' + safeName}
    WHERE id = ${id}
  `

  return NextResponse.json({ ok: true })
}
