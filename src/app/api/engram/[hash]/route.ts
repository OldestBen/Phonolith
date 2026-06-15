export const dynamic = 'force-dynamic'

import { sql } from '@/lib/db'
import { NextResponse } from 'next/server'

// GET /api/engram/[hash]
// Returns: { versions: MetadataVersion[] }
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params
  const rows = await sql<{
    id: number
    blake3_hash: string
    snapshot: Record<string, unknown>
    source: string
    note: string | null
    created_at: string
  }[]>`
    SELECT id, blake3_hash, snapshot, source, note, created_at
    FROM metadata_versions
    WHERE blake3_hash = ${hash}
    ORDER BY created_at DESC
    LIMIT 50
  `
  return NextResponse.json({ versions: rows })
}
