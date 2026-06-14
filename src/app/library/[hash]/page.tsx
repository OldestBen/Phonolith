'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { LibraryFile } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(ms?: number): string {
  if (!ms) return '—'
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function DrBadge({ score }: { score?: number }) {
  if (score == null) return <span className="text-text-muted text-5xl font-bold">—</span>
  const color = score > 12 ? 'text-success' : score >= 8 ? 'text-warning' : 'text-danger'
  const label = score > 12 ? 'Excellent' : score >= 8 ? 'Good' : 'Compressed'
  return (
    <div className="flex flex-col items-start">
      <span className={`text-5xl font-bold font-mono ${color}`}>{score}</span>
      <span className={`text-xs mt-1 ${color}`}>{label}</span>
    </div>
  )
}

// ── Info row ──────────────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-border/50">
      <span className="text-text-muted text-sm w-36 shrink-0">{label}</span>
      <span className="text-text-primary text-sm break-all">{value}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FileDetailPage() {
  const { hash } = useParams<{ hash: string }>()
  const [file, setFile] = useState<LibraryFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [matchMsg, setMatchMsg] = useState<string | null>(null)
  const [waveformError, setWaveformError] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/library/${hash}`)
      .then(r => r.ok ? r.json() : { file: null })
      .then(data => setFile(data.file ?? data))
      .catch(() => setFile(null))
      .finally(() => setLoading(false))
  }, [hash])

  const handleMatch = async () => {
    setMatching(true)
    setMatchMsg(null)
    try {
      const r = await fetch(`/api/library/${hash}/match`, { method: 'POST' })
      const data = await r.json()
      setMatchMsg(data.message ?? 'Match request sent.')
      if (data.file) setFile(data.file)
    } catch {
      setMatchMsg('Match failed — check your AcoustID configuration.')
    } finally {
      setMatching(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-4 bg-surface-2 rounded w-24 mb-8" />
        <div className="h-7 bg-surface-2 rounded w-2/3 mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 bg-surface-2 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted">File not found.</p>
      </div>
    )
  }

  const filename = file.file_path.split('/').pop() ?? file.file_path

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-20 md:pb-8">
      {/* Back link */}
      <Link
        href="/library"
        className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-accent
                   transition-colors mb-6 group"
      >
        <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
        Back to Library
      </Link>

      <h1 className="text-text-primary text-xl font-bold font-mono mb-1 break-all">{filename}</h1>
      <p className="text-text-muted text-xs font-mono mb-8 break-all">{file.file_path}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* File info */}
        <div className="lg:col-span-2">
          <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">File Info</h2>
          <div className="bg-surface rounded-xl border border-border p-4">
            <InfoRow label="Format" value={file.format?.toUpperCase() ?? '—'} />
            <InfoRow label="Bitrate" value={file.bitrate ? `${file.bitrate} kbps` : '—'} />
            <InfoRow label="Sample Rate" value={file.sample_rate ? `${(file.sample_rate / 1000).toFixed(1)} kHz` : '—'} />
            <InfoRow label="Bit Depth" value={file.bit_depth ? `${file.bit_depth}-bit` : '—'} />
            <InfoRow label="Duration" value={formatDuration(file.duration_ms)} />
            <InfoRow label="Indexed" value={new Date(file.indexed_at).toLocaleString()} />
          </div>
        </div>

        {/* DR + Quality */}
        <div>
          <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">Dynamic Range</h2>
          <div className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-4">
            <DrBadge score={file.dr_score} />
            <div>
              <span className="text-text-muted text-xs">Spectral Quality</span>
              <div className="mt-1">
                {file.spectral_ok == null ? (
                  <span className="text-text-muted text-sm">Not analysed</span>
                ) : file.spectral_ok ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg
                                   bg-success/10 border border-success/20 text-success text-sm">
                    ✓ Clean
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg
                                   bg-danger/10 border border-danger/20 text-danger text-sm">
                    ✗ Issues detected
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Waveform */}
      <div className="mb-8">
        <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">Waveform</h2>
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {waveformError ? (
            <div className="flex items-center justify-center h-24 text-text-muted text-sm">
              Waveform not available
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/waveforms/${hash}`}
              alt="Waveform"
              className="w-full"
              onError={() => setWaveformError(true)}
            />
          )}
        </div>
      </div>

      {/* Matched song */}
      <div className="mb-8">
        <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">Matched Song</h2>
        <div className="bg-surface rounded-xl border border-border p-4">
          {file.song_id ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-primary font-medium">{file.song_title ?? 'Unknown Title'}</p>
                {file.song_artist && (
                  <p className="text-text-muted text-sm mt-0.5">{file.song_artist}</p>
                )}
              </div>
              <Link
                href={`/song/${file.song_id}`}
                className="px-3 py-1.5 rounded-lg bg-accent/20 border border-accent/30 text-accent text-xs
                           font-medium hover:bg-accent/30 transition-colors"
              >
                View song →
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg
                               bg-surface-2 border border-border text-text-muted text-sm">
                Unmatched
              </span>
              <button
                onClick={handleMatch}
                disabled={matching}
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-text-primary text-xs
                           font-medium hover:bg-surface transition-colors disabled:opacity-50"
              >
                {matching ? 'Matching…' : 'Match via AcoustID'}
              </button>
            </div>
          )}
          {matchMsg && (
            <p className="text-text-muted text-xs mt-3">{matchMsg}</p>
          )}
        </div>
      </div>

      {/* Fingerprint */}
      {file.fingerprint && (
        <div>
          <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">Fingerprint</h2>
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-text-muted text-xs font-mono break-all">
              {file.fingerprint.slice(0, 80)}{file.fingerprint.length > 80 ? '…' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
