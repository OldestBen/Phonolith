import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'
import { signPeerRequest, getOwnPeerId, type Peer } from '@/lib/polyphony'
import { spawn } from 'child_process'
import { Readable } from 'stream'

/** Triggers a pg_dump and pushes it to a trusted peer for off-site mirroring. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  const rows = await sql`SELECT * FROM peers WHERE id = ${id} AND trust_status = 'trusted'` as unknown as Peer[]
  const peer = rows[0]
  if (!peer) return NextResponse.json({ error: 'Peer not found or not trusted.' }, { status: 404 })

  const dbUrl = process.env.DATABASE_URL || 'postgresql://phonolith:phonolith@db:5432/phonolith'
  const child = spawn('pg_dump', [dbUrl])
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })

  const ownId = await getOwnPeerId()
  const signature = signPeerRequest(peer.shared_secret, 'POST', '/api/polyphony/backup/receive', '')

  let res: Response
  try {
    res = await fetch(`${peer.host}/api/polyphony/backup/receive`, {
      method: 'POST',
      // @ts-expect-error - Node fetch requires duplex for streaming request bodies
      duplex: 'half',
      body: Readable.toWeb(child.stdout) as unknown as ReadableStream,
      headers: {
        'X-Polyphony-Peer-Id': ownId,
        'X-Polyphony-Signature': signature,
      },
      signal: AbortSignal.timeout(120000),
    })
  } catch (err) {
    child.kill()
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Could not reach peer: ${msg}` }, { status: 502 })
  }

  const exitCode: number = await new Promise(resolve => {
    child.on('exit', code => resolve(code ?? 0))
  })
  if (exitCode !== 0) {
    return NextResponse.json({ error: `pg_dump failed: ${stderr.trim()}` }, { status: 500 })
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Peer rejected the backup.' }))
    return NextResponse.json({ error: err.error ?? 'Peer rejected the backup.' }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({ status: 'mirrored', peer: peer.name, ...data })
}
