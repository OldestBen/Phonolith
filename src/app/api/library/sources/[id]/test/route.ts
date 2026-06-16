export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const rows = await sql`SELECT * FROM library_sources WHERE id = ${id}`
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const source = rows[0]
  const { resolveConfig } = await import('@/lib/crypto')
  const config = resolveConfig(source.config)
  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'

  try {
    const res = await fetch(`${analystUrl}/test-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: source.type, config }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach analyst sidecar' }, { status: 502 })
  }
}
