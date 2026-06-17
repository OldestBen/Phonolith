export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { triggerScan } from '@/lib/analyst'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { resolveConfig } from '@/lib/crypto'

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'

  try {
    const sources = await sql`SELECT * FROM library_sources WHERE enabled = true ORDER BY created_at`

    if (sources.length === 0) {
      // No sources configured — fall back to the legacy /music default
      await triggerScan()
      return NextResponse.json({ ok: true, message: 'Scan started' })
    }

    // Trigger the analyst's /scan-source for every configured source in sequence.
    // The analyst serialises scans internally so firing them one-by-one is fine.
    let triggered = 0
    for (const source of sources) {
      const config = resolveConfig(source.config as Record<string, string>)
      try {
        await fetch(`${analystUrl}/scan-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_id: source.id, type: source.type, config, name: source.name }),
        })
        await sql`UPDATE library_sources SET last_scanned_at = NOW() WHERE id = ${source.id}`
        triggered++
      } catch {
        // Log but don't abort — try remaining sources
      }
    }

    const msg = triggered === 0
      ? 'Could not reach analyst sidecar'
      : `Scanning ${triggered} source${triggered !== 1 ? 's' : ''}`
    return NextResponse.json({ ok: triggered > 0, message: msg })
  } catch {
    return NextResponse.json({ error: 'Analyst sidecar unavailable' }, { status: 502 })
  }
}
