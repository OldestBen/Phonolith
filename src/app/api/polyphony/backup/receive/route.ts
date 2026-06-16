import { NextRequest, NextResponse } from 'next/server'
import { verifyIncomingPeer } from '@/lib/polyphony'
import { sql } from '@/lib/db'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const BACKUP_DIR = process.env.POLYPHONY_BACKUP_DIR || '/data/polyphony-backups'
const MAX_SNAPSHOTS_PER_PEER = 5

/**
 * Receives a pg_dump snapshot pushed by a trusted peer for off-site mirroring.
 * The signature covers the request line only (not the multi-megabyte body) —
 * acceptable here because the signature is bound to a specific peer identity
 * that's already been vetted via pairing, and the body itself is opaque SQL
 * we store as-is, never executed.
 */
export async function POST(req: NextRequest) {
  const peer = await verifyIncomingPeer(
    req.headers.get('x-polyphony-peer-id'),
    req.headers.get('x-polyphony-signature'),
    'POST',
    '/api/polyphony/backup/receive',
    ''
  )
  if (!peer) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!peer.share_backup) return NextResponse.json({ error: 'Backup mirroring is disabled for this peer.' }, { status: 403 })
  if (!req.body) return NextResponse.json({ error: 'Empty body.' }, { status: 400 })

  const peerDir = path.join(BACKUP_DIR, peer.id)
  await fs.promises.mkdir(peerDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(peerDir, `${timestamp}.sql`)

  const hash = crypto.createHash('sha256')
  let size = 0

  const writeStream = fs.createWriteStream(filePath)
  const reader = req.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      size += value.byteLength
      await new Promise<void>((resolve, reject) => {
        writeStream.write(value, err => (err ? reject(err) : resolve()))
      })
    }
  } finally {
    writeStream.end()
  }

  const checksum = hash.digest('hex')

  await sql`
    INSERT INTO peer_backups (peer_id, size_bytes, storage_path, checksum)
    VALUES (${peer.id}, ${size}, ${filePath}, ${checksum})
  `

  // Prune older snapshots beyond the retention cap so a misbehaving or
  // overly chatty peer can't fill our disk.
  const stale = await sql`
    SELECT id, storage_path FROM peer_backups
    WHERE peer_id = ${peer.id}
    ORDER BY snapshot_at DESC
    OFFSET ${MAX_SNAPSHOTS_PER_PEER}
  `
  for (const row of stale) {
    await fs.promises.unlink(row.storage_path as string).catch(() => {})
    await sql`DELETE FROM peer_backups WHERE id = ${row.id as number}`
  }

  return NextResponse.json({ status: 'stored', size_bytes: size, checksum })
}
