export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(
  _req: Request,
  { params }: { params: { hash: string } }
) {
  const { hash } = params
  const rows = await sql`SELECT file_path FROM library_files WHERE blake3_hash = ${hash}`
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'File not found' }, { status: 404 })

  const filePath = rows[0].file_path as string
  // Only local paths — SMB UNC paths (\\host\share\...) can't be read by the analyst container
  if (filePath.startsWith('\\\\') || filePath.startsWith('//')) {
    return NextResponse.json({ ok: false, error: 'Deep scan is only available for locally mounted files.' })
  }

  const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'
  try {
    const r = await fetch(`${analystUrl}/deep-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await r.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach analyst sidecar' }, { status: 502 })
  }
}
