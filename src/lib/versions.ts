// Pure grouping logic for the album version-comparison view.
//
// Given the library files matched to an album's songs, collapse them into
// distinct "versions" — one per unique format/bit-depth/sample-rate signature —
// with an averaged DR score, and rank them best-quality-first (higher DR, then
// bit depth, then sample rate). Extracted from the versions route so it can be
// unit-tested without a database.

export interface VersionSignatureFields {
  format?: string | null
  bit_depth?: number | null
  sample_rate?: number | null
  bitrate?: number | null
  dr_score?: number | null
  spectral_ok?: boolean | null
  accuraterip_status?: string | null
}

export interface LibraryVersion<T extends VersionSignatureFields> {
  signature: string
  format?: string | null
  bit_depth?: number | null
  sample_rate?: number | null
  bitrate?: number | null
  dr_avg: number | null
  dr_scores: number[]
  spectral_ok: boolean
  accuraterip_status?: string | null
  track_count: number
  tracks: T[]
}

export function groupFileVersions<T extends VersionSignatureFields>(
  files: T[]
): LibraryVersion<T>[] {
  const signatureMap = new Map<string, T[]>()
  for (const f of files) {
    const sig = [f.format, f.bit_depth, f.sample_rate].filter(Boolean).join('/')
    const key = sig || 'unknown'
    if (!signatureMap.has(key)) signatureMap.set(key, [])
    signatureMap.get(key)!.push(f)
  }

  return Array.from(signatureMap.entries())
    .map(([sig, tracks]) => {
      const drScores = tracks
        .map(t => t.dr_score)
        .filter((d): d is number => d != null)
      const avgDr = drScores.length
        ? drScores.reduce((a, b) => a + b, 0) / drScores.length
        : null
      const sample = tracks[0]
      return {
        signature: sig,
        format: sample.format,
        bit_depth: sample.bit_depth,
        sample_rate: sample.sample_rate,
        bitrate: sample.bitrate,
        dr_avg: avgDr != null ? Math.round(avgDr * 10) / 10 : null,
        dr_scores: drScores,
        spectral_ok: tracks.every(t => t.spectral_ok),
        accuraterip_status: sample.accuraterip_status,
        track_count: tracks.length,
        tracks,
      }
    })
    .sort((a, b) => {
      // Sort by quality: prefer higher DR, then higher bit depth, then higher sample rate
      const drDiff = (b.dr_avg ?? 0) - (a.dr_avg ?? 0)
      if (drDiff !== 0) return drDiff
      const bdDiff = (b.bit_depth ?? 0) - (a.bit_depth ?? 0)
      if (bdDiff !== 0) return bdDiff
      return (b.sample_rate ?? 0) - (a.sample_rate ?? 0)
    })
}
