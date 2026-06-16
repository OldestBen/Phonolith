export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { Transform } from 'stream'
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSetting, setSetting } from '@/lib/settings'

const LAST_BACKUP_KEY = 'aegis_last_backup'

export async function GET() {
  const configured = !!(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID)

  let lastBackup = null
  const raw = await getSetting(LAST_BACKUP_KEY)
  if (raw) {
    try {
      lastBackup = JSON.parse(raw)
    } catch {
      lastBackup = null
    }
  }

  return NextResponse.json({
    configured,
    last_backup: lastBackup,
  })
}

export async function POST() {
  const bucket = process.env.S3_BUCKET
  const region = process.env.S3_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return NextResponse.json({ error: 'S3 not configured' }, { status: 500 })
  }

  const dbUrl = process.env.DATABASE_URL || 'postgresql://phonolith:phonolith@db:5432/phonolith'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const s3Key = `backups/phonolith-${timestamp}.sql`

  try {
    const child = spawn('pg_dump', [dbUrl])

    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })

    // Counts bytes as they pass through, so we can record the final dump
    // size without buffering the whole stream to measure it.
    let bytesWritten = 0
    const counter = new Transform({
      transform(chunk, _enc, callback) {
        bytesWritten += chunk.length
        callback(null, chunk)
      },
    })
    child.stdout.pipe(counter)

    const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: s3Key,
        Body: counter,
        ContentType: 'application/sql',
      },
    })

    const exitCodePromise: Promise<number> = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', code => resolve(code ?? 0))
    })

    const [exitCode] = await Promise.all([exitCodePromise, upload.done()])

    if (exitCode !== 0) {
      throw new Error(`pg_dump exited with code ${exitCode}: ${stderr.trim()}`)
    }

    await setSetting(LAST_BACKUP_KEY, JSON.stringify({
      timestamp,
      s3_key: s3Key,
      size_bytes: bytesWritten,
    }))

    return NextResponse.json({ ok: true, timestamp, s3_key: s3Key, size_bytes: bytesWritten })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
