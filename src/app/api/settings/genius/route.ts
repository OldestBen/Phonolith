export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET() {
  const token = process.env.GENIUS_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ ok: false, error: 'GENIUS_ACCESS_TOKEN is not set in environment' })
  }
  try {
    const r = await fetch('https://api.genius.com/search?q=test', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return NextResponse.json({ ok: true })
    return NextResponse.json({ ok: false, error: `Genius API returned ${r.status}` })
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach Genius API' })
  }
}
