export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

/** Locally mirrored backup snapshots we're holding on behalf of trusted peers. */
export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    SELECT pb.id, pb.peer_id, p.name AS peer_name, pb.snapshot_at, pb.size_bytes, pb.checksum
    FROM peer_backups pb
    JOIN peers p ON p.id = pb.peer_id
    ORDER BY pb.snapshot_at DESC
    LIMIT 100
  `
  return NextResponse.json({ snapshots: rows })
}
