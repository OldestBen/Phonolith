export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getFile, getFingerprint } from '@/lib/analyst'
import axios from 'axios'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { getSetting } from '@/lib/settings'

export async function POST(req: NextRequest, { params }: { params: { hash: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const fileRows = await sql`
    SELECT id, file_path, fingerprint FROM library_files WHERE blake3_hash = ${params.hash}
  `
  if (fileRows.length === 0) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const file = fileRows[0]
  let fingerprint = file.fingerprint

  if (!fingerprint) {
    fingerprint = await getFingerprint(file.file_path)
    if (!fingerprint) return NextResponse.json({ error: 'Fingerprinting failed' }, { status: 502 })
  }

  // Query AcoustID
  try {
    const apiKey = await getSetting('ACOUSTID_API_KEY')
    if (!apiKey) return NextResponse.json({ error: 'ACOUSTID_API_KEY not set' }, { status: 500 })

    const res = await axios.get('https://api.acoustid.org/v2/lookup', {
      params: {
        client: apiKey,
        fingerprint,
        meta: 'recordings',
      },
      timeout: 10000,
    })

    const results = res.data.results
    if (!results || results.length === 0) {
      return NextResponse.json({ matched: false })
    }

    const mbRecordingId: string | undefined = results[0]?.recordings?.[0]?.id
    if (!mbRecordingId) return NextResponse.json({ matched: false })

    // Try to find matching song in DB by mb_id
    const songRows = await sql`SELECT id FROM songs WHERE mb_id = ${mbRecordingId}::uuid`
    if (songRows.length > 0) {
      await sql`
        UPDATE library_files SET song_id = ${songRows[0].id} WHERE id = ${file.id}
      `
      return NextResponse.json({ matched: true, song_id: songRows[0].id, mb_recording_id: mbRecordingId })
    }

    return NextResponse.json({ matched: false, mb_recording_id: mbRecordingId })
  } catch {
    return NextResponse.json({ error: 'AcoustID lookup failed' }, { status: 502 })
  }
}
