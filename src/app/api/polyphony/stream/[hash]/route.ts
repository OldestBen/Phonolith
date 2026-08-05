import { NextRequest, NextResponse } from 'next/server'
import { verifyIncomingPeer } from '@/lib/polyphony'

const LUCID_URL = process.env.LUCID_URL || 'http://lucid:8001'

/**
 * Streams audio bytes to a trusted peer. Unlike local browser/ALSA/AirPlay
 * playback — where Caddy routes /stream/* straight to Lucid so the Next.js
 * process never touches media bytes — Lucid's stream endpoint has no
 * concept of peer trust. Proxying here, after verifying the peer signature,
 * is the narrow exception: it's the only way to keep "never serve the
 * library to an unauthenticated caller" true for cross-instance streaming.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  const peer = await verifyIncomingPeer(
    req.headers.get('x-polyphony-peer-id'),
    req.headers.get('x-polyphony-signature'),
    'GET',
    `/api/polyphony/stream/${hash}`,
    ''
  )
  if (!peer) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!peer.share_library) return NextResponse.json({ error: 'Library sharing is disabled for this peer.' }, { status: 403 })

  const range = req.headers.get('range')
  let upstream: Response
  try {
    upstream = await fetch(`${LUCID_URL}/stream/${encodeURIComponent(hash)}`, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return NextResponse.json({ error: 'Stream backend unreachable.' }, { status: 502 })
  }

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: 'Track not found.' }, { status: upstream.status })
  }

  const headers = new Headers()
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(key)
    if (v) headers.set(key, v)
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers })
}
