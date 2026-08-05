import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { getOwnPeerId, getOwnName } from '@/lib/polyphony'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const rows = await sql`
    SELECT id, name, host, trust_status, share_library, share_presence, share_backup, paired_at, last_seen_at
    FROM peers ORDER BY paired_at DESC
  `
  return NextResponse.json({ peers: rows })
}

/** Initiator side of pairing: we hold a code from the target instance's admin. */
export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: { host?: string; code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { host, code } = body
  if (!host || !code) {
    return NextResponse.json({ error: 'host and code are required.' }, { status: 400 })
  }

  let parsedHost: URL
  try {
    parsedHost = new URL(host)
  } catch {
    return NextResponse.json({ error: 'host must be a valid URL.' }, { status: 400 })
  }
  if (parsedHost.protocol !== 'http:' && parsedHost.protocol !== 'https:') {
    return NextResponse.json({ error: 'host must be http or https.' }, { status: 400 })
  }

  const ownId = await getOwnPeerId()
  const ownName = await getOwnName()

  let res: Response
  try {
    res = await fetch(`${parsedHost.origin}/api/polyphony/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, peerId: ownId, name: ownName, host: req.nextUrl.origin }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach that host.' }, { status: 502 })
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Pairing failed.' }))
    return NextResponse.json({ error: err.error ?? 'Pairing failed.' }, { status: res.status })
  }

  const data = await res.json() as { peerId: string; name: string; sharedSecret: string }

  await sql`
    INSERT INTO peers (id, name, host, shared_secret, trust_status)
    VALUES (${data.peerId}, ${data.name}, ${parsedHost.origin}, ${data.sharedSecret}, 'trusted')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      host = EXCLUDED.host,
      shared_secret = EXCLUDED.shared_secret,
      trust_status = 'trusted',
      paired_at = NOW()
  `

  return NextResponse.json({ status: 'paired', peerId: data.peerId, name: data.name })
}
