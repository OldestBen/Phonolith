export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { getDownloadStatus } from '@/lib/soulcatcher'

// slskd transfer states are things like "Completed, Succeeded", "InProgress",
// "Queued, Remotely", "Completed, Errored", "Completed, Cancelled". We only
// need to know whether a transfer finished successfully, failed, or is still
// moving — bucket on substrings rather than an exact enum match.
function mapSlskdState(state: string): 'downloading' | 'completed' | 'failed' | null {
  const s = state.toLowerCase()
  if (s.includes('completed')) {
    return s.includes('succeeded') ? 'completed' : 'failed'
  }
  if (s.includes('inprogress') || s.includes('queued') || s.includes('initializing')) {
    return 'downloading'
  }
  return null
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const pending = await sql`
    SELECT * FROM soulcatcher_downloads
    WHERE status IN ('queued', 'downloading')
  `

  if (pending.length > 0) {
    const transfers = await getDownloadStatus()

    for (const row of pending) {
      const match = transfers.find(t => t.username === row.username && t.filename === row.filename)
      if (!match) continue

      const mapped = mapSlskdState(match.state)
      if (!mapped || mapped === row.status) continue

      if (mapped === 'completed' || mapped === 'failed') {
        await sql`
          UPDATE soulcatcher_downloads
          SET status = ${mapped}, completed_at = NOW()
          WHERE id = ${row.id}
        `
      } else {
        await sql`
          UPDATE soulcatcher_downloads
          SET status = ${mapped}
          WHERE id = ${row.id}
        `
      }
    }
  }

  const downloads = await sql`
    SELECT * FROM soulcatcher_downloads
    ORDER BY requested_at DESC
  `
  return NextResponse.json({ downloads })
}
