export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { verifyInternalServiceToken } from '@/lib/auth'

// Called by the analyst sidecar at scan start to fetch all already-indexed
// local file identities in one round trip, so unchanged files can be skipped.
export async function GET(req: NextRequest) {
  if (!verifyInternalServiceToken(req.headers.get('X-Internal-Token'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await sql<{ inode: number; mtime: number; file_size: number }[]>`
    SELECT inode, mtime, file_size
    FROM library_files
    WHERE inode IS NOT NULL
      AND mtime IS NOT NULL
      AND file_size IS NOT NULL
      AND waveform_path IS NOT NULL
  `

  return NextResponse.json(rows)
}
