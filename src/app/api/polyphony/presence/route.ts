import { NextRequest, NextResponse } from 'next/server'
import { verifyIncomingPeer, getOwnName } from '@/lib/polyphony'
import { rget } from '@/lib/redis'

interface NowPlaying {
  title: string
  artist: string | null
  updatedAt: string
}

export async function GET(req: NextRequest) {
  const peer = await verifyIncomingPeer(
    req.headers.get('x-polyphony-peer-id'),
    req.headers.get('x-polyphony-signature'),
    'GET',
    '/api/polyphony/presence',
    ''
  )
  if (!peer) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!peer.share_presence) return NextResponse.json({ error: 'Presence sharing is disabled for this peer.' }, { status: 403 })

  const nowPlaying = await rget<NowPlaying>('polyphony:now_playing')
  return NextResponse.json({
    name: await getOwnName(),
    online: true,
    nowPlaying,
  })
}
