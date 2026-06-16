export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { triggerScan } from '@/lib/analyst'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  try {
    await triggerScan()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Analyst sidecar unavailable' }, { status: 502 })
  }
}
