export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = await req.json() as { enabled?: boolean; name?: string; config?: Record<string, string> }
  const rows = await sql`
    UPDATE library_sources
    SET
      enabled = COALESCE(${body.enabled ?? null}, enabled),
      name = COALESCE(${body.name ?? null}, name),
      config = COALESCE(${body.config ? sql.json(body.config) : null}, config)
    WHERE id = ${id}
    RETURNING *
  `
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  await sql`DELETE FROM library_sources WHERE id = ${id}`
  return NextResponse.json({ ok: true })
}
