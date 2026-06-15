export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function POST() {
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
