export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { redis } from '@/lib/redis'

// Internal route called by the analyst sidecar
export async function POST(req: NextRequest) {
  const data = await req.json() as {
    blake3_hash: string
    file_path: string
    format?: string
    bitrate?: number
    sample_rate?: number
    bit_depth?: number
    duration_ms?: number
    dr_score?: number
    spectral_ok?: boolean
    waveform_path?: string
    fingerprint?: string
  }

  if (!data.blake3_hash || !data.file_path) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  await sql`
    INSERT INTO library_files (
      blake3_hash, file_path, format, bitrate, sample_rate, bit_depth,
      duration_ms, dr_score, spectral_ok, waveform_path, fingerprint, indexed_at
    ) VALUES (
      ${data.blake3_hash}, ${data.file_path}, ${data.format ?? null},
      ${data.bitrate ?? null}, ${data.sample_rate ?? null}, ${data.bit_depth ?? null},
      ${data.duration_ms ?? null}, ${data.dr_score ?? null}, ${data.spectral_ok ?? null},
      ${data.waveform_path ?? null}, ${data.fingerprint ?? null}, NOW()
    )
    ON CONFLICT (blake3_hash) DO UPDATE
    SET file_path = EXCLUDED.file_path,
        format = EXCLUDED.format,
        bitrate = EXCLUDED.bitrate,
        sample_rate = EXCLUDED.sample_rate,
        bit_depth = EXCLUDED.bit_depth,
        duration_ms = EXCLUDED.duration_ms,
        dr_score = EXCLUDED.dr_score,
        spectral_ok = EXCLUDED.spectral_ok,
        waveform_path = EXCLUDED.waveform_path,
        fingerprint = EXCLUDED.fingerprint,
        indexed_at = NOW()
  `

  // Pub-sub event for real-time UI
  try {
    await redis.publish(`library:indexed`, JSON.stringify({ hash: data.blake3_hash }))
  } catch {
    // Redis unavailable — non-fatal
  }

  return NextResponse.json({ ok: true })
}
