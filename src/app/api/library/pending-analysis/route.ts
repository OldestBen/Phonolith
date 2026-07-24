export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { verifyInternalServiceToken } from '@/lib/auth'

// Internal route called by the analyst sidecar — there's no browser session
// for this call, so it's gated by the shared X-Internal-Token instead.
export async function GET(req: NextRequest) {
  if (!verifyInternalServiceToken(req.headers.get('x-internal-token'))) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // When a source_id is supplied, the caller (the analyst, chaining a deep pass
  // after an SMB scan) has that source's connection config in hand and can
  // download+analyse network files — so scope to the source and include SMB
  // paths. Without it (the manual local "Analyse Unscanned" button), network
  // paths are excluded since they can't be deep-scanned from the path alone.
  const sourceIdParam = req.nextUrl.searchParams.get('source_id')
  const sourceId = sourceIdParam ? parseInt(sourceIdParam, 10) : null

  const rows = sourceId != null && !Number.isNaN(sourceId)
    ? await sql`
        SELECT blake3_hash, file_path
        FROM library_files
        WHERE dr_score IS NULL
          AND file_path IS NOT NULL
          AND source_id = ${sourceId}
        ORDER BY indexed_at DESC
        LIMIT 500
      `
    : await sql`
        SELECT blake3_hash, file_path
        FROM library_files
        WHERE dr_score IS NULL
          AND file_path IS NOT NULL
          AND file_path NOT LIKE '\\\\%'   -- exclude SMB UNC paths
          AND file_path NOT LIKE '//%'     -- exclude network paths
        ORDER BY indexed_at DESC
        LIMIT 500
      `
  return NextResponse.json(rows)
}
