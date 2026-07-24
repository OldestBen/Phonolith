export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/settings'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

// Scan behaviour preferences. Kept out of the masked-secrets /settings/keys
// route because these are plain booleans the UI needs to read back, not
// credentials to hide. Currently just the auto-deep-analysis toggle: whether
// the heavy DR/waveform/fingerprint pass runs automatically after the fast
// metadata pass, or only on demand via "Analyse Unscanned".

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const autoDeepAnalysis = (await getSetting('auto_deep_analysis')) !== 'false'
  return NextResponse.json({ autoDeepAnalysis })
}

export async function PUT(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await req.json().catch(() => null) as { autoDeepAnalysis?: boolean } | null
  if (typeof body?.autoDeepAnalysis !== 'boolean') {
    return NextResponse.json({ error: 'autoDeepAnalysis must be a boolean' }, { status: 400 })
  }

  await setSetting('auto_deep_analysis', body.autoDeepAnalysis ? 'true' : 'false')
  return NextResponse.json({ ok: true, autoDeepAnalysis: body.autoDeepAnalysis })
}
