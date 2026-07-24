export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

// Runtime proxy to the analyst sidecar's waveform PNGs.
//
// This used to be a next.config.js rewrite, but Next.js evaluates rewrites()
// at *build* time and bakes the destination into the routes manifest. Inside
// the Docker image ANALYST_URL isn't set at build time, so the rewrite froze
// to the `http://localhost:8000` fallback and every waveform/cover fetch hit
// ECONNREFUSED at runtime. A route handler reads ANALYST_URL per request, so
// the same image works wherever it's deployed.
const ANALYST_URL = process.env.ANALYST_URL || 'http://analyst:8000'

export async function GET(_req: NextRequest, { params }: { params: { hash: string } }) {
  let upstream: Response
  try {
    upstream = await fetch(`${ANALYST_URL}/waveforms/${encodeURIComponent(params.hash)}`, {
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
      'Content-Type': upstream.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
