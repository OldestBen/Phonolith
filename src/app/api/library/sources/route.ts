export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET() {
  const sources = await sql`SELECT * FROM library_sources ORDER BY created_at`
  return NextResponse.json(sources)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name: string
    type: 'local' | 'smb' | 'nfs' | 'iscsi'
    config: Record<string, string>
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  if (!body.type) return NextResponse.json({ error: 'Missing type' }, { status: 400 })

  const rows = await sql`
    INSERT INTO library_sources (name, type, config)
    VALUES (${body.name.trim()}, ${body.type}, ${JSON.stringify(body.config ?? {})})
    RETURNING *
  `
  return NextResponse.json(rows[0], { status: 201 })
}
