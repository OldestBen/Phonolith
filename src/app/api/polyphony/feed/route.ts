export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { fetchFromPeer, type Peer } from '@/lib/polyphony'
import { rget, rset } from '@/lib/redis'

interface FeedEntry {
  peerId: string
  name: string
  online: boolean
  nowPlaying: { title: string; artist: string | null; updatedAt: string } | null
}

/** Aggregates presence from every trusted, presence-sharing peer. Cached briefly to bound fan-out cost. */
export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const cached = await rget<FeedEntry[]>('polyphony:feed')
  if (cached) return NextResponse.json({ feed: cached })

  const peers = await sql`
    SELECT * FROM peers WHERE trust_status = 'trusted' AND share_presence = TRUE
  ` as unknown as Peer[]

  const feed: FeedEntry[] = await Promise.all(
    peers.map(async (peer): Promise<FeedEntry> => {
      try {
        const res = await fetchFromPeer(peer, '/api/polyphony/presence')
        if (!res.ok) return { peerId: peer.id, name: peer.name, online: false, nowPlaying: null }
        const data = await res.json()
        return { peerId: peer.id, name: peer.name, online: true, nowPlaying: data.nowPlaying ?? null }
      } catch {
        return { peerId: peer.id, name: peer.name, online: false, nowPlaying: null }
      }
    })
  )

  await rset('polyphony:feed', feed, 10)
  return NextResponse.json({ feed })
}
