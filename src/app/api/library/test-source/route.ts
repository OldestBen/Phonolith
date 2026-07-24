export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

// Validate a not-yet-saved source config by proxying to the analyst's
// /test-source. Unlike sources/[id]/test (which loads and decrypts a stored
// source), this takes the config straight from the Add Source dialog so the
// user can verify credentials/path *before* committing the source.
export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { type, config } = await req.json() as {
    type: 'local' | 'smb' | 'nfs' | 'iscsi'
    config: Record<string, string>
  }
  if (!type) return NextResponse.json({ ok: false, error: 'Missing source type' }, { status: 400 })

  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'
  try {
    const res = await fetch(`${analystUrl}/test-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, config: config ?? {} }),
      signal: AbortSignal.timeout(20000),
    })
    return NextResponse.json(await res.json(), { status: res.ok ? 200 : 502 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach analyst sidecar' }, { status: 502 })
  }
}
