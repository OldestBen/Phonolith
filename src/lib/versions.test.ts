import { describe, it, expect } from 'vitest'
import { groupFileVersions, type VersionSignatureFields } from '@/lib/versions'

// Minimal file-row factory — only the fields groupFileVersions reads.
function file(overrides: Partial<VersionSignatureFields> & { id?: number } = {}) {
  return {
    id: 0,
    format: 'flac',
    bit_depth: 16,
    sample_rate: 44100,
    bitrate: 900000,
    dr_score: 12,
    spectral_ok: true,
    accuraterip_status: 'verified',
    ...overrides,
  }
}

describe('groupFileVersions', () => {
  it('collapses files with the same format/bit-depth/sample-rate into one version', () => {
    const versions = groupFileVersions([
      file({ id: 1 }),
      file({ id: 2 }),
      file({ id: 3 }),
    ])
    expect(versions).toHaveLength(1)
    expect(versions[0].track_count).toBe(3)
    expect(versions[0].signature).toBe('flac/16/44100')
  })

  it('separates distinct signatures into distinct versions', () => {
    const versions = groupFileVersions([
      file({ format: 'flac', bit_depth: 24, sample_rate: 96000 }),
      file({ format: 'mp3', bit_depth: null, sample_rate: 44100 }),
    ])
    expect(versions).toHaveLength(2)
  })

  it('averages DR scores and rounds to one decimal', () => {
    const versions = groupFileVersions([
      file({ dr_score: 10 }),
      file({ dr_score: 13 }),
    ])
    expect(versions[0].dr_avg).toBe(11.5)
    expect(versions[0].dr_scores).toEqual([10, 13])
  })

  it('ignores null DR scores when averaging, dr_avg is null when none present', () => {
    const withSome = groupFileVersions([file({ dr_score: 8 }), file({ dr_score: null })])
    expect(withSome[0].dr_avg).toBe(8)

    const withNone = groupFileVersions([file({ dr_score: null }), file({ dr_score: null })])
    expect(withNone[0].dr_avg).toBeNull()
  })

  it('ranks higher DR first, then bit depth, then sample rate', () => {
    const versions = groupFileVersions([
      file({ format: 'mp3', bit_depth: null, sample_rate: 44100, dr_score: 7 }),   // lowest DR
      file({ format: 'flac', bit_depth: 24, sample_rate: 96000, dr_score: 14 }),   // highest DR
      file({ format: 'flac', bit_depth: 16, sample_rate: 44100, dr_score: 14 }),   // tie DR, lower depth
    ])
    expect(versions.map(v => v.signature)).toEqual([
      'flac/24/96000',
      'flac/16/44100',
      'mp3/44100',
    ])
  })

  it('spectral_ok is true only when every file in the version is clean', () => {
    const clean = groupFileVersions([file({ spectral_ok: true }), file({ spectral_ok: true })])
    expect(clean[0].spectral_ok).toBe(true)
    const dirty = groupFileVersions([file({ spectral_ok: true }), file({ spectral_ok: false })])
    expect(dirty[0].spectral_ok).toBe(false)
  })

  it('files with no signature fields bucket under "unknown"', () => {
    const versions = groupFileVersions([
      { format: null, bit_depth: null, sample_rate: null, dr_score: null, spectral_ok: null },
    ])
    expect(versions).toHaveLength(1)
    expect(versions[0].signature).toBe('unknown')
  })

  it('returns an empty array for no files', () => {
    expect(groupFileVersions([])).toEqual([])
  })
})
