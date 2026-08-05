import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getOwnPeerId, getOwnName, generateSharedSecret, redeemPairingCode } from '@/lib/polyphony'

/**
 * Responder side of pairing. Called by the *other* instance's server (not a
 * browser) with the one-time code an admin generated locally and read aloud
 * to whoever is pairing in. Possession of a valid, unexpired code is the
 * entire trust decision here — this is the only Polyphony endpoint that
 * doesn't require an existing peer relationship, by design.
 */
export async function POST(req: NextRequest) {
  let body: { code?: string; peerId?: string; name?: string; host?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { code, peerId, name, host } = body
  if (!code || !peerId || !name || !host) {
    return NextResponse.json({ error: 'code, peerId, name, and host are required.' }, { status: 400 })
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

  const valid = await redeemPairingCode(code)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid or expired pairing code.' }, { status: 403 })
  }

  const sharedSecret = generateSharedSecret()

  await sql`
    INSERT INTO peers (id, name, host, shared_secret, trust_status)
    VALUES (${peerId}, ${name}, ${parsedHost.origin}, ${sharedSecret}, 'trusted')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      host = EXCLUDED.host,
      shared_secret = EXCLUDED.shared_secret,
      trust_status = 'trusted',
      paired_at = NOW()
  `

  return NextResponse.json({
    peerId: await getOwnPeerId(),
    name: await getOwnName(),
    sharedSecret,
  })
}
