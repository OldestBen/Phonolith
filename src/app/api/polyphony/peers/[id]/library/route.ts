import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { fetchFromPeer, type Peer } from '@/lib/polyphony'

/** Our browser can't hold the peer shared secret, so this route signs the request server-side. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  const rows = await sql`SELECT * FROM peers WHERE id = ${id} AND trust_status = 'trusted'` as unknown as Peer[]
  const peer = rows[0]
  if (!peer) return NextResponse.json({ error: 'Peer not found or not trusted.' }, { status: 404 })

  try {
    const res = await fetchFromPeer(peer, '/api/polyphony/library')
    if (!res.ok) return NextResponse.json({ error: 'Peer rejected the request.' }, { status: res.status })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Could not reach peer.' }, { status: 502 })
  }
}
