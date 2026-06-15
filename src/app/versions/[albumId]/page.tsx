'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Track {
  blake3_hash: string
  song_title: string
  track_number?: number
  format?: string
  bit_depth?: number
  sample_rate?: number
  bitrate?: number
  duration_ms?: number
  dr_score?: number
  spectral_ok?: boolean
  accuraterip_status?: string
  file_path: string
}

interface Version {
  signature: string
  format?: string
  bit_depth?: number
  sample_rate?: number
  bitrate?: number
  dr_avg: number | null
  dr_scores: number[]
  spectral_ok: boolean
  accuraterip_status?: string
  track_count: number
  tracks: Track[]
}

interface AlbumData {
  id: number
  name: string
  artist_name: string
  cover_art_url?: string
  release_date?: string
}

function formatHz(hz?: number): string {
  if (!hz) return '—'
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`
}

function DrBadge({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-text-muted font-mono">—</span>
  const cls = score > 12 ? 'text-success' : score >= 8 ? 'text-warning' : 'text-danger'
  return <span className={`font-mono font-bold ${cls}`}>{score}</span>
}

function QualityTier({ v }: { v: Version }) {
  const bd = v.bit_depth ?? 0
  const sr = v.sample_rate ?? 0
  const fmt = v.format?.toLowerCase() ?? ''
  const dr = v.dr_avg ?? 0

  if (fmt === 'flac' && bd >= 24 && sr >= 88200 && dr > 12)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/10 border border-success/20 text-success">Hi-Res Lossless</span>
  if (fmt === 'flac' && dr > 12)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/10 border border-success/20 text-success">CD Lossless</span>
  if (fmt === 'flac' && dr >= 8)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/10 border border-warning/20 text-warning">Lossless (compressed master)</span>
  if (['mp3', 'aac', 'm4a', 'ogg', 'opus'].includes(fmt))
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger/10 border border-danger/20 text-danger">Lossy</span>
  return null
}

export default function VersionComparePage() {
  const { albumId } = useParams<{ albumId: string }>()
  const [album, setAlbum] = useState<AlbumData | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/api/versions/${albumId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) { setAlbum(data.album); setVersions(data.versions) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [albumId])

  const toggleExpanded = (sig: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(sig) ? next.delete(sig) : next.add(sig)
      return next
    })
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse space-y-4">
        <div className="h-6 bg-surface-2 rounded w-48" />
        <div className="h-32 bg-surface-2 rounded-xl" />
        <div className="h-32 bg-surface-2 rounded-xl" />
      </div>
    )
  }

  if (!album) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted">Album not found.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <Link
        href="/versions"
        className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-accent transition-colors mb-6 group"
      >
        <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
        Version Comparison
      </Link>

      {/* Album header */}
      <div className="flex items-start gap-4 mb-8">
        {album.cover_art_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={album.cover_art_url} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-accent/20 shrink-0 flex items-center justify-center">
            <span className="text-accent text-xl font-bold">{album.name.charAt(0)}</span>
          </div>
        )}
        <div>
          <h1 className="text-text-primary text-xl font-bold">{album.name}</h1>
          <p className="text-text-muted text-sm mt-0.5">
            {album.artist_name}
            {album.release_date && ` · ${album.release_date.slice(0, 4)}`}
          </p>
          <p className="text-text-muted text-xs mt-1">
            {versions.length} version{versions.length !== 1 ? 's' : ''} in library · sorted by quality
          </p>
        </div>
      </div>

      {/* Comparison header */}
      {versions.length > 1 && (
        <div className="mb-4 p-3 bg-surface border border-border rounded-xl text-xs text-text-muted">
          <span className="text-text-primary font-semibold">Recommendation: </span>
          {(() => {
            const best = versions[0]
            const parts = []
            if (best.format) parts.push(best.format.toUpperCase())
            if (best.bit_depth) parts.push(`${best.bit_depth}bit`)
            if (best.sample_rate) parts.push(formatHz(best.sample_rate))
            if (best.dr_avg) parts.push(`DR${best.dr_avg}`)
            return `${parts.join(' / ')} (${best.signature}) scores highest on dynamic range and format quality.`
          })()}
        </div>
      )}

      {/* Version cards */}
      <div className="space-y-4">
        {versions.map((v, idx) => (
          <div
            key={v.signature}
            className={`rounded-xl border bg-surface transition-colors ${
              idx === 0 ? 'border-accent/40' : 'border-border'
            }`}
          >
            {/* Version summary row */}
            <button
              onClick={() => toggleExpanded(v.signature)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left"
            >
              {idx === 0 && (
                <span className="shrink-0 text-[10px] font-bold text-accent uppercase tracking-widest">
                  Best
                </span>
              )}
              {idx > 0 && (
                <span className="shrink-0 text-[10px] font-bold text-text-muted uppercase tracking-widest">
                  #{idx + 1}
                </span>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-text-primary text-sm font-mono font-medium">
                    {[v.format?.toUpperCase(), v.bit_depth && `${v.bit_depth}bit`, formatHz(v.sample_rate)]
                      .filter(Boolean).join(' / ') || v.signature}
                  </span>
                  <QualityTier v={v} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted font-mono">
                  {v.bitrate && <span>{v.bitrate} kbps</span>}
                  <span>{v.track_count} track{v.track_count !== 1 ? 's' : ''}</span>
                  {v.spectral_ok ? (
                    <span className="text-success">✓ Spectral clean</span>
                  ) : (
                    <span className="text-warning">⚠ Spectral issues</span>
                  )}
                  {v.accuraterip_status === 'verified' && (
                    <span className="text-success">✓ AccurateRip verified</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                <div className="text-right">
                  <p className="text-text-muted text-[10px] uppercase tracking-widest mb-0.5">Avg DR</p>
                  <DrBadge score={v.dr_avg} />
                </div>
                <svg
                  className={`w-4 h-4 text-text-muted transition-transform ${expanded.has(v.signature) ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>

            {/* Track list */}
            {expanded.has(v.signature) && (
              <div className="border-t border-border px-5 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left text-text-muted font-medium py-2 pr-3 w-8">#</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-3">Title</th>
                      <th className="text-right text-text-muted font-medium py-2 pr-3">DR</th>
                      <th className="text-right text-text-muted font-medium py-2">Spectral</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.tracks.map(t => (
                      <tr key={t.blake3_hash} className="border-b border-border/30 hover:bg-surface-2">
                        <td className="py-2 pr-3 text-text-muted">{t.track_number ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <Link
                            href={`/library/${t.blake3_hash}`}
                            className="text-text-primary hover:text-accent transition-colors"
                          >
                            {t.song_title}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-right"><DrBadge score={t.dr_score} /></td>
                        <td className="py-2 text-right">
                          {t.spectral_ok == null ? (
                            <span className="text-text-muted">—</span>
                          ) : t.spectral_ok ? (
                            <span className="text-success">✓</span>
                          ) : (
                            <span className="text-warning">⚠</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
