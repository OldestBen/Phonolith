export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'
  try {
    const r = await fetch(`${analystUrl}/deep-scan-pending`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    })
    const data = await r.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach analyst sidecar' }, { status: 502 })
  }
}
