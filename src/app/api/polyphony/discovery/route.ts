import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { setSetting } from '@/lib/settings'
import { getOwnPeerId, getOwnName, isPublicDiscoveryEnabled } from '@/lib/polyphony'

const LUCID_URL = process.env.LUCID_URL || 'http://lucid:8001'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let discovered: unknown[] = []
  try {
    const r = await fetch(`${LUCID_URL}/polyphony/discovered`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) discovered = await r.json()
  } catch {
    // Lucid offline — discovery just comes back empty
  }

  return NextResponse.json({
    enabled: await isPublicDiscoveryEnabled(),
    discovered,
  })
}

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: { enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const enabled = Boolean(body.enabled)
  await setSetting('polyphony_public_discovery_enabled', enabled ? 'true' : 'false')

  try {
    await fetch(`${LUCID_URL}/polyphony/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled,
        peer_id: await getOwnPeerId(),
        name: await getOwnName(),
        port: Number(process.env.HTTP_PORT) || 80,
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Lucid offline — the setting is still persisted and will take effect once it's back
  }

  return NextResponse.json({ enabled })
}
