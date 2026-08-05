export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { verifyIncomingPeer } from '@/lib/polyphony'

/**
 * Library listing for a trusted peer to browse. Deliberately exposes only
 * the BLAKE3 hash and display metadata — never the local filesystem path —
 * so a remote peer learns nothing about this machine's directory layout.
 */
export async function GET(req: NextRequest) {
  const peer = await verifyIncomingPeer(
    req.headers.get('x-polyphony-peer-id'),
    req.headers.get('x-polyphony-signature'),
    'GET',
    '/api/polyphony/library',
    ''
  )
  if (!peer) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!peer.share_library) return NextResponse.json({ error: 'Library sharing is disabled for this peer.' }, { status: 403 })

  const rows = await sql`
    SELECT lf.blake3_hash AS hash, lf.title, lf.artist, lf.album, lf.year, t.track_number, lf.duration_ms, lf.format
    FROM library_files lf
    LEFT JOIN tracks t ON lf.track_id = t.id
    ORDER BY lf.artist, lf.album, t.track_number
  `
  return NextResponse.json({ files: rows })
}
