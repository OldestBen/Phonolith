export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const rows = await sql`SELECT * FROM library_sources WHERE id = ${id}`
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const source = rows[0]
  const config = typeof source.config === 'string' ? JSON.parse(source.config) : source.config
  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'

  try {
    const res = await fetch(`${analystUrl}/test-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: source.type, config }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach analyst sidecar' }, { status: 502 })
  }
}
