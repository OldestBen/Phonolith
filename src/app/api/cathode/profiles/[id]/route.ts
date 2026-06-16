export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/cathode/profiles/[id]  → single profile + total_hours
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  const profileId = parseInt(id)
  if (isNaN(profileId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const rows = await sql`
    SELECT id, name, description, device_type, components, total_hours, lucid_device, created_at
    FROM hardware_profiles
    WHERE id = ${profileId}
  `
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(rows[0])
}

// PUT /api/cathode/profiles/[id]  → update fields (name, description, components, lucid_device)
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  const profileId = parseInt(id)
  if (isNaN(profileId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const body = await req.json() as {
    name?: string
    description?: string
    device_type?: string
    components?: Array<{ role: string; model: string }>
    lucid_device?: string
  }

  const rows = await sql`
    UPDATE hardware_profiles SET
      name         = COALESCE(${body.name ?? null}, name),
      description  = CASE WHEN ${body.description !== undefined} THEN ${body.description ?? null} ELSE description END,
      device_type  = COALESCE(${body.device_type ?? null}, device_type),
      components   = CASE WHEN ${body.components !== undefined} THEN ${JSON.stringify(body.components ?? [])}::jsonb ELSE components END,
      lucid_device = CASE WHEN ${body.lucid_device !== undefined} THEN ${body.lucid_device ?? null} ELSE lucid_device END
    WHERE id = ${profileId}
    RETURNING id, name, description, device_type, components, total_hours, lucid_device, created_at
  `
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(rows[0])
}

// DELETE /api/cathode/profiles/[id]  → delete profile
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  const profileId = parseInt(id)
  if (isNaN(profileId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  await sql`DELETE FROM hardware_profiles WHERE id = ${profileId}`
  return NextResponse.json({ ok: true })
}
