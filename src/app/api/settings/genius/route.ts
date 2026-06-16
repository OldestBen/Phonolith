export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSetting } from '@/lib/settings'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const token = await getSetting('GENIUS_ACCESS_TOKEN')
  if (!token) {
    return NextResponse.json({ ok: false, error: 'GENIUS_ACCESS_TOKEN is not set in environment or database' })
  }
  try {
    const r = await fetch('https://api.genius.com/search?q=test', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return NextResponse.json({ ok: true })
    return NextResponse.json({ ok: false, error: `Genius API returned ${r.status}` })
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach Genius API' })
  }
}
