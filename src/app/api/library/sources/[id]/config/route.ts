export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { verifyInternalServiceToken } from '@/lib/auth'

// Internal-only: returns a source's *decrypted* connection config (host, share,
// credentials, …) so the Lucid playback sidecar can open media files directly
// over SMB. Lucid only bind-mounts the local /music tree, so SMB-sourced tracks
// (stored with a `//host/share/...` path) aren't openable as local files — Lucid
// streams them over the wire instead, and needs the credentials to do so.
//
// Gated by the shared service token ONLY — never a browser session — because the
// response contains decrypted secrets. The browser-facing library APIs never
// return this.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyInternalServiceToken(req.headers.get('x-internal-token'))) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const rows = await sql`SELECT * FROM library_sources WHERE id = ${id}`
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { resolveConfig } = await import('@/lib/crypto')
  const config = resolveConfig(rows[0].config)

  return NextResponse.json({ type: rows[0].type, config })
}
