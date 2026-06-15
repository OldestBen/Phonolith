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
    accuraterip_status?: string
    accuraterip_crc?: string
  }

  if (!data.blake3_hash || !data.file_path) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  await sql`
    INSERT INTO library_files (
      blake3_hash, file_path, format, bitrate, sample_rate, bit_depth,
      duration_ms, dr_score, spectral_ok, waveform_path, fingerprint,
      accuraterip_status, indexed_at
    ) VALUES (
      ${data.blake3_hash}, ${data.file_path}, ${data.format ?? null},
      ${data.bitrate ?? null}, ${data.sample_rate ?? null}, ${data.bit_depth ?? null},
      ${data.duration_ms ?? null}, ${data.dr_score ?? null}, ${data.spectral_ok ?? null},
      ${data.waveform_path ?? null}, ${data.fingerprint ?? null},
      ${data.accuraterip_status ?? null}, NOW()
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
        accuraterip_status = EXCLUDED.accuraterip_status,
        accuraterip_confidence = EXCLUDED.accuraterip_confidence,
        indexed_at = NOW()
  `

  await sql`
    INSERT INTO metadata_versions (blake3_hash, snapshot, source)
    VALUES (
      ${data.blake3_hash},
      ${sql.json({
        format: data.format,
        bitrate: data.bitrate,
        sample_rate: data.sample_rate,
        bit_depth: data.bit_depth,
        duration_ms: data.duration_ms,
        dr_score: data.dr_score,
        spectral_ok: data.spectral_ok,
        fingerprint: data.fingerprint,
      })},
      'ingest'
    )
  `

  // Pub-sub event for real-time UI
  try {
    await redis.publish(`library:indexed`, JSON.stringify({ hash: data.blake3_hash }))
  } catch {
    // Redis unavailable — non-fatal
  }

  return NextResponse.json({ ok: true })
}
