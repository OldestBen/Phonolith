export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { redis } from '@/lib/redis'

type IngestPayload = {
  blake3_hash: string
  file_path?: string        // deprecated but still accepted for old callers
  source_id?: number
  relative_path?: string
  format?: string
  bitrate?: number
  sample_rate?: number
  bit_depth?: number
  duration_ms?: number
  dr_score?: number
  spectral_ok?: boolean
  waveform_path?: string
  cover_art_path?: string
  fingerprint?: string      // AcoustID fingerprint
  mb_recording_id?: string
  accuraterip_status?: string
  accuraterip_crc?: string
  title?: string
  artist?: string
  album?: string
  year?: string
  track_number?: number
  disc_number?: number
  engineer?: string
  inode?: number
  file_size?: number
  mtime?: number
}

// Internal route called by the analyst sidecar
export async function POST(req: NextRequest) {
  const data = await req.json() as IngestPayload

  if (!data.blake3_hash) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // ── Track find-or-create ────────────────────────────────────────────────────
  let trackId: string | null = null

  if (data.fingerprint) {
    const existing = await sql`SELECT id FROM tracks WHERE acoustid = ${data.fingerprint} LIMIT 1`
    if (existing.length > 0) trackId = existing[0].id as string
  }
  if (!trackId && data.mb_recording_id) {
    const existing = await sql`SELECT id FROM tracks WHERE mb_recording_id = ${data.mb_recording_id} LIMIT 1`
    if (existing.length > 0) trackId = existing[0].id as string
  }
  if (!trackId) {
    const inserted = await sql`
      INSERT INTO tracks (acoustid, mb_recording_id, title, artist_name, album_name, year, disc_number, track_number, duration_ms)
      VALUES (
        ${data.fingerprint ?? null}, ${data.mb_recording_id ?? null},
        ${data.title ?? null}, ${data.artist ?? null}, ${data.album ?? null},
        ${data.year ?? null}, ${data.disc_number ?? 1}, ${data.track_number ?? null},
        ${data.duration_ms ?? null}
      )
      RETURNING id
    `
    trackId = inserted[0].id as string
  }

  // ── Upsert library_files ────────────────────────────────────────────────────
  await sql`
    INSERT INTO library_files (
      blake3_hash, file_path, source_id, relative_path,
      format, bitrate, sample_rate, bit_depth,
      duration_ms, dr_score, spectral_ok, waveform_path,
      fingerprint, accuraterip_status,
      track_id, title, artist, album, year,
      track_number, disc_number, engineer,
      inode, file_size, mtime,
      cover_art_path,
      indexed_at
    ) VALUES (
      ${data.blake3_hash}, ${data.file_path ?? null}, ${data.source_id ?? null}, ${data.relative_path ?? null},
      ${data.format ?? null}, ${data.bitrate ?? null}, ${data.sample_rate ?? null}, ${data.bit_depth ?? null},
      ${data.duration_ms ?? null}, ${data.dr_score ?? null}, ${data.spectral_ok ?? null}, ${data.waveform_path ?? null},
      ${data.fingerprint ?? null}, ${data.accuraterip_status ?? null},
      ${trackId}, ${data.title ?? null}, ${data.artist ?? null}, ${data.album ?? null}, ${data.year ?? null},
      ${data.track_number ?? null}, ${data.disc_number ?? 1}, ${data.engineer ?? null},
      ${data.inode ?? null}, ${data.file_size ?? null}, ${data.mtime ?? null},
      ${data.cover_art_path ?? null},
      NOW()
    )
    ON CONFLICT (blake3_hash) DO UPDATE
    SET file_path = EXCLUDED.file_path,
        source_id = EXCLUDED.source_id,
        relative_path = EXCLUDED.relative_path,
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
        track_id = EXCLUDED.track_id,
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        album = EXCLUDED.album,
        year = EXCLUDED.year,
        track_number = EXCLUDED.track_number,
        disc_number = EXCLUDED.disc_number,
        engineer = EXCLUDED.engineer,
        inode = EXCLUDED.inode,
        file_size = EXCLUDED.file_size,
        mtime = EXCLUDED.mtime,
        cover_art_path = EXCLUDED.cover_art_path,
        indexed_at = NOW()
  `

  // ── Engram snapshot ─────────────────────────────────────────────────────────
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
        mb_recording_id: data.mb_recording_id,
        title: data.title,
        artist: data.artist,
        album: data.album,
        year: data.year,
        track_number: data.track_number,
        disc_number: data.disc_number,
        engineer: data.engineer,
        cover_art_path: data.cover_art_path,
      })},
      'ingest'
    )
  `

  // ── Pub-sub event for real-time UI ──────────────────────────────────────────
  try {
    await redis.publish(`library:indexed`, JSON.stringify({ hash: data.blake3_hash, track_id: trackId }))
  } catch {
    // Redis unavailable — non-fatal
  }

  return NextResponse.json({ ok: true, track_id: trackId })
}
