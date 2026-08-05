export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

// POST /api/cathode/profiles/[id]/hours
// body: { hours: number }  → adds to total_hours for the profile
// Used by Lucid when a track finishes playing on a known endpoint.
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  const profileId = parseInt(id)
  if (isNaN(profileId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const body = await req.json() as { hours: number }
  if (typeof body.hours !== 'number' || body.hours < 0) {
    return NextResponse.json({ error: 'hours must be a non-negative number' }, { status: 400 })
  }

  const rows = await sql`
    UPDATE hardware_profiles
    SET total_hours = total_hours + ${body.hours}
    WHERE id = ${profileId}
    RETURNING id, name, total_hours
  `
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(rows[0])
}
