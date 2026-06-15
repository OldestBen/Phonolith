export const dynamic = 'force-dynamic'

import { sql } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

const RESTORABLE_FIELDS = [
  'format',
  'bitrate',
  'sample_rate',
  'bit_depth',
  'duration_ms',
  'dr_score',
  'spectral_ok',
  'fingerprint',
] as const

type RestorableField = typeof RESTORABLE_FIELDS[number]

// POST /api/engram/[hash]/restore
// Body: { version_id: number, fields?: string[] }
// Returns: { ok: true, restored_fields: string[] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params
  const body = await req.json() as { version_id: number; fields?: string[] }
  const { version_id, fields } = body

  if (!version_id) {
    return NextResponse.json({ error: 'Missing version_id' }, { status: 400 })
  }

  // Fetch the target snapshot
  const [target] = await sql<{ snapshot: Record<string, unknown> }[]>`
    SELECT snapshot
    FROM metadata_versions
    WHERE id = ${version_id} AND blake3_hash = ${hash}
  `

  if (!target) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }

  // Determine which fields to restore
  const fieldsToRestore: RestorableField[] = fields && fields.length > 0
    ? (fields.filter((f): f is RestorableField => RESTORABLE_FIELDS.includes(f as RestorableField)))
    : [...RESTORABLE_FIELDS]

  if (fieldsToRestore.length === 0) {
    return NextResponse.json({ error: 'No valid fields to restore' }, { status: 400 })
  }

  // Snapshot current state before restoring
  const [current] = await sql<{
    format: string | null
    bitrate: number | null
    sample_rate: number | null
    bit_depth: number | null
    duration_ms: number | null
    dr_score: number | null
    spectral_ok: boolean | null
    fingerprint: string | null
  }[]>`
    SELECT
      format, bitrate, sample_rate, bit_depth, duration_ms,
      dr_score, spectral_ok, fingerprint
    FROM library_files
    WHERE blake3_hash = ${hash}
  `

  if (current) {
    await sql`
      INSERT INTO metadata_versions (blake3_hash, snapshot, source, note)
      VALUES (
        ${hash},
        ${sql.json({
          format: current.format,
          bitrate: current.bitrate,
          sample_rate: current.sample_rate,
          bit_depth: current.bit_depth,
          duration_ms: current.duration_ms,
          dr_score: current.dr_score,
          spectral_ok: current.spectral_ok,
          fingerprint: current.fingerprint,
        })},
        'restore',
        ${`Auto-snapshot before restore to version ${version_id}`}
      )
    `
  }

  // Build and execute the update
  const snap = target.snapshot
  const updates: Record<string, unknown> = {}
  for (const field of fieldsToRestore) {
    updates[field] = snap[field] ?? null
  }

  await sql`
    UPDATE library_files
    SET
      format        = CASE WHEN ${fieldsToRestore.includes('format')}         THEN ${updates['format'] as string | null}        ELSE format        END,
      bitrate       = CASE WHEN ${fieldsToRestore.includes('bitrate')}        THEN ${updates['bitrate'] as number | null}       ELSE bitrate       END,
      sample_rate   = CASE WHEN ${fieldsToRestore.includes('sample_rate')}    THEN ${updates['sample_rate'] as number | null}   ELSE sample_rate   END,
      bit_depth     = CASE WHEN ${fieldsToRestore.includes('bit_depth')}      THEN ${updates['bit_depth'] as number | null}     ELSE bit_depth     END,
      duration_ms   = CASE WHEN ${fieldsToRestore.includes('duration_ms')}    THEN ${updates['duration_ms'] as number | null}   ELSE duration_ms   END,
      dr_score      = CASE WHEN ${fieldsToRestore.includes('dr_score')}       THEN ${updates['dr_score'] as number | null}      ELSE dr_score      END,
      spectral_ok   = CASE WHEN ${fieldsToRestore.includes('spectral_ok')}    THEN ${updates['spectral_ok'] as boolean | null}  ELSE spectral_ok   END,
      fingerprint   = CASE WHEN ${fieldsToRestore.includes('fingerprint')}    THEN ${updates['fingerprint'] as string | null}   ELSE fingerprint   END
    WHERE blake3_hash = ${hash}
  `

  return NextResponse.json({ ok: true, restored_fields: fieldsToRestore })
}
