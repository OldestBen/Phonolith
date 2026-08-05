export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { downloadFile } from '@/lib/soulcatcher'

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const username = body?.username
  const filename = body?.filename
  const size = body?.size
  const query = body?.query

  if (
    typeof username !== 'string' || !username ||
    typeof filename !== 'string' || !filename ||
    typeof size !== 'number' ||
    typeof query !== 'string' || !query
  ) {
    return NextResponse.json({ error: 'Body must include username, filename, size, and query.' }, { status: 400 })
  }

  const ok = await downloadFile(username, filename, size)
  if (!ok) {
    return NextResponse.json({ error: 'Could not enqueue download — slskd unavailable.' }, { status: 502 })
  }

  const rows = await sql`
    INSERT INTO soulcatcher_downloads (query, username, filename, size_bytes, status)
    VALUES (${query}, ${username}, ${filename}, ${size}, 'queued')
    RETURNING *
  `

  return NextResponse.json({ download: rows[0] })
}
