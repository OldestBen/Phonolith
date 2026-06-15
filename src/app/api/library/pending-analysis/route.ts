export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

// Internal route called by analyst to get files needing deep analysis
export async function GET() {
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
