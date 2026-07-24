export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

// Runtime proxy to the analyst sidecar's extracted cover art. See the sibling
// waveforms route for why this is a route handler and not a next.config.js
// rewrite (build-time rewrites baked in the localhost fallback → ECONNREFUSED).
const ANALYST_URL = process.env.ANALYST_URL || 'http://analyst:8000'

export async function GET(_req: NextRequest, { params }: { params: { hash: string } }) {
  let upstream: Response
  try {
    upstream = await fetch(`${ANALYST_URL}/waveforms/${encodeURIComponent(params.hash)}/cover`, {
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ error: 'Analyst unreachable' }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Not found' }, { status: upstream.status || 404 })
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
