export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(
  _req: Request,
  { params }: { params: { hash: string } }
) {
  const { hash } = params
  const rows = await sql`
    SELECT lf.file_path, lf.source_id, s.type AS source_type, s.config AS source_config
    FROM library_files lf
    LEFT JOIN library_sources s ON s.id = lf.source_id
    WHERE lf.blake3_hash = ${hash}
  `
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'File not found' }, { status: 404 })

  const row = rows[0]
  const filePath = row.file_path as string
  const sourceType = (row.source_type as string | null) ?? 'local'
  const isSmb = sourceType === 'smb' || filePath.startsWith('\\\\') || filePath.startsWith('//')

  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'
  const body: Record<string, unknown> = { path: filePath }

  if (isSmb) {
    const { resolveConfig } = await import('@/lib/crypto')
    const config = resolveConfig(row.source_config)
    if (!config.host || !config.share) {
      return NextResponse.json({ ok: false, error: 'SMB source configuration not found for this file.' })
    }
    body.source_type = 'smb'
    body.config = config
    body.source_id = row.source_id ?? null
  }

  try {
    const r = await fetch(`${analystUrl}/deep-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await r.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach analyst sidecar' }, { status: 502 })
  }
}
