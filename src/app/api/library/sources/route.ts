export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { encryptConfig, resolveConfig } from '@/lib/crypto'

export async function GET() {
  const sources = await sql`SELECT * FROM library_sources ORDER BY created_at`
  // Decrypt config before returning — strip sensitive credential fields
  const safe = sources.map((s: Record<string, unknown>) => ({
    ...s,
    config: sanitiseConfig(resolveConfig(s.config)),
  }))
  return NextResponse.json(safe)
}

/** Remove plaintext passwords from API responses */
function sanitiseConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = { ...cfg }
  if (out.password) out.password = '••••••••'
  return out
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name: string
    type: 'local' | 'smb' | 'nfs' | 'iscsi'
    config: Record<string, string>
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  if (!body.type) return NextResponse.json({ error: 'Missing type' }, { status: 400 })

  const encrypted = encryptConfig(body.config ?? {})

  const rows = await sql`
    INSERT INTO library_sources (name, type, config)
    VALUES (${body.name.trim()}, ${body.type}, ${encrypted})
    RETURNING *
  `
  const row = rows[0] as Record<string, unknown>
  return NextResponse.json({ ...row, config: sanitiseConfig(resolveConfig(row.config)) }, { status: 201 })
}
