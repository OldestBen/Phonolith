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

  const rows = await sql`
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
