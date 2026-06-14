export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { sql } from '@/lib/db'

const execAsync = promisify(exec)

export async function GET() {
  const rows = await sql`
    SELECT value FROM schema_migrations ORDER BY applied_at DESC LIMIT 1
  `.catch(() => [])

  return NextResponse.json({
    configured: !!(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID),
    last_backup: null,
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
  const filename = `/tmp/phonolith-backup-${timestamp}.sql`

  try {
    await execAsync(`pg_dump ${dbUrl} -f ${filename}`)

    const fs = await import('fs')
    const data = fs.readFileSync(filename)

    const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `backups/phonolith-${timestamp}.sql`,
      Body: data,
      ContentType: 'application/sql',
    }))

    fs.unlinkSync(filename)

    return NextResponse.json({ ok: true, timestamp })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
