export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { host, port = 445 } = await req.json() as { host: string; port?: number }
  if (!host?.trim()) return NextResponse.json({ reachable: false, error: 'Missing host' }, { status: 400 })

  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'
  try {
    const res = await fetch(`${analystUrl}/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: host.trim(), port }),
      signal: AbortSignal.timeout(10000),
    })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ reachable: false, error: 'Analyst sidecar not reachable' }, { status: 502 })
  }
}
