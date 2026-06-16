import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { signPeerRequest, getOwnPeerId, type Peer } from '@/lib/polyphony'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; hash: string }> }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id, hash } = await params
  const rows = await sql`SELECT * FROM peers WHERE id = ${id} AND trust_status = 'trusted'` as unknown as Peer[]
  const peer = rows[0]
  if (!peer) return NextResponse.json({ error: 'Peer not found or not trusted.' }, { status: 404 })

  const path = `/api/polyphony/stream/${hash}`
  const ownId = await getOwnPeerId()
  const signature = signPeerRequest(peer.shared_secret, 'GET', path, '')

  const range = req.headers.get('range')
  let upstream: Response
  try {
    upstream = await fetch(`${peer.host}${path}`, {
      headers: {
        'X-Polyphony-Peer-Id': ownId,
        'X-Polyphony-Signature': signature,
        ...(range ? { Range: range } : {}),
      },
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach peer.' }, { status: 502 })
  }

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: 'Track unavailable.' }, { status: upstream.status })
  }

  const headers = new Headers()
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(key)
    if (v) headers.set(key, v)
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers })
}
