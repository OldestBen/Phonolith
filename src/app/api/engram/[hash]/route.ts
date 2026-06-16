export const dynamic = 'force-dynamic'

import { sql } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

// GET /api/engram/[hash]
// Returns: { versions: MetadataVersion[] }
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

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
