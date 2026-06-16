'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { LibraryFile, MetadataVersion } from '@/lib/types'
import { useGaplessPlayer } from '@/hooks/useGaplessPlayer'

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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-border/50">
      <span className="text-text-muted text-sm w-36 shrink-0">{label}</span>
      <span className="text-text-primary text-sm break-all">{value}</span>
    </div>
  )
}

// ── Engram version history ────────────────────────────────────────────────────
const SOURCE_BADGE: Record<string, string> = {
  ingest:      'bg-surface-2 border-border text-text-muted',
  user:        'bg-accent/10 border-accent/20 text-accent',
  lexicon:     'bg-success/10 border-success/20 text-success',
  musicbrainz: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
  restore:     'bg-warning/10 border-warning/20 text-warning',
}

function EngramHistory({ hash }: { hash: string }) {
  const [versions, setVersions] = useState<MetadataVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch(`/api/engram/${hash}`)
      .then(r => r.ok ? r.json() : { versions: [] })
      .then(d => setVersions(d.versions ?? d ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRestore = async (id: number) => {
    if (!confirm('Restore this metadata snapshot? Current state will be auto-snapshotted first.')) return
    setRestoring(id)
    setMsg(null)
    try {
      const r = await fetch(`/api/engram/${hash}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: id }),
      })
      const data = await r.json()
      setMsg(data.ok ? `Restored ${data.restored_fields?.length ?? 'all'} fields.` : (data.error ?? 'Restore failed'))
      if (data.ok) load()
    } catch {
      setMsg('Restore failed')
    } finally {
      setRestoring(null)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  if (loading) return <div className="h-24 animate-pulse bg-surface-2 rounded-xl" />

  if (versions.length === 0) {
    return <p className="text-text-muted text-sm py-4">No version history yet.</p>
  }

  return (
    <div className="space-y-2">
      {msg && <p className="text-accent text-sm mb-2">{msg}</p>}
      {versions.map((v, i) => (
        <div key={v.id} className="flex items-start gap-3 bg-surface-2 rounded-xl px-4 py-3 border border-border/50">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${SOURCE_BADGE[v.source] ?? SOURCE_BADGE.ingest}`}>
                {v.source}
              </span>
              {i === 0 && (
                <span className="text-[10px] text-text-muted">(current)</span>
              )}
              <span className="text-text-muted text-[11px] ml-auto">{new Date(v.created_at).toLocaleString()}</span>
            </div>
            {v.note && <p className="text-text-muted text-xs">{v.note}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-0 mt-1">
              {v.snapshot.format != null && (
                <span className="text-text-muted text-[11px] font-mono">{String(v.snapshot.format).toUpperCase()}</span>
              )}
              {v.snapshot.bit_depth != null && (
                <span className="text-text-muted text-[11px] font-mono">{String(v.snapshot.bit_depth)}bit</span>
              )}
              {v.snapshot.sample_rate != null && (
                <span className="text-text-muted text-[11px] font-mono">{(Number(v.snapshot.sample_rate) / 1000).toFixed(1)}kHz</span>
              )}
              {v.snapshot.dr_score != null && (
                <span className="text-text-muted text-[11px] font-mono">DR{String(v.snapshot.dr_score)}</span>
              )}
            </div>
          </div>
          {i > 0 && (
            <button
              onClick={() => handleRestore(v.id)}
              disabled={restoring === v.id}
              className="shrink-0 px-2.5 py-1 rounded-lg border border-border text-text-muted text-xs hover:border-accent/40 hover:text-accent transition-colors disabled:opacity-40"
            >
              {restoring === v.id ? '…' : 'Restore'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = 'info' | 'history'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FileDetailPage() {
  const { hash } = useParams<{ hash: string }>()
  const [file, setFile] = useState<LibraryFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [matchMsg, setMatchMsg] = useState<string | null>(null)
  const [waveformError, setWaveformError] = useState(false)
  const [tab, setTab] = useState<Tab>('info')
  const [deepScanning, setDeepScanning] = useState(false)
  const [deepScanMsg, setDeepScanMsg] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playMsg, setPlayMsg] = useState<string | null>(null)
  const browserPlayer = useGaplessPlayer()

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

  const handleDeepScan = async () => {
    setDeepScanning(true)
    setDeepScanMsg(null)
    try {
      const r = await fetch(`/api/library/${hash}/deep-scan`, { method: 'POST' })
      const data = await r.json()
      setDeepScanMsg(data.message ?? (data.ok ? 'Deep scan started — results update shortly.' : (data.error ?? 'Failed')))
    } catch {
      setDeepScanMsg('Could not reach analyst sidecar.')
    } finally {
      setDeepScanning(false)
      setTimeout(() => setDeepScanMsg(null), 8000)
    }
  }

  const handlePlay = async () => {
    if (!file) return
    setPlaying(true)
    setPlayMsg(null)
    try {
      const r = await fetch('/api/lucid/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.file_path }),
      })
      const data = await r.json()
      if (data.error || data.online === false) {
        setPlayMsg(data.error ?? 'Lucid is offline — enable the audio Docker profile.')
      } else {
        setPlayMsg('Playing…')
        setTimeout(() => setPlayMsg(null), 3000)
      }
    } catch {
      setPlayMsg('Lucid is offline.')
    } finally {
      setPlaying(false)
    }
  }

  const handleQueue = async () => {
    if (!file) return
    try {
      await fetch('/api/lucid/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.file_path }),
      })
      setPlayMsg('Added to queue.')
      setTimeout(() => setPlayMsg(null), 3000)
    } catch {
      setPlayMsg('Lucid is offline.')
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
  const isLocal = !file.file_path.startsWith('\\\\') && !file.file_path.startsWith('//')

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-24 md:pb-8">
      {/* Back */}
      <Link href="/library" className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-accent transition-colors mb-6 group">
        <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
        Back to Library
      </Link>

      <h1 className="text-text-primary text-xl font-bold font-mono mb-1 break-all">{filename}</h1>
      <p className="text-text-muted text-xs font-mono mb-4 break-all">{file.file_path}</p>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={handlePlay}
          disabled={playing || !isLocal}
          title={!isLocal ? 'Playback requires a locally mounted file' : undefined}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          {playing ? 'Starting…' : 'Play'}
        </button>
        <button
          onClick={handleQueue}
          disabled={!isLocal}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-text-primary text-sm font-medium hover:border-accent/40 transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          Add to Queue
        </button>
        <button
          onClick={() => browserPlayer.currentHash === hash && browserPlayer.isPlaying
            ? browserPlayer.pause()
            : browserPlayer.playQueue([hash])}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-text-primary text-sm font-medium hover:border-accent/40 transition-colors"
          title="Decode and play directly in this browser tab — no ALSA hardware required"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
          {browserPlayer.currentHash === hash && browserPlayer.isPlaying ? 'Pause (Browser)' : 'Play in Browser'}
        </button>
        {isLocal && (
          <button
            onClick={handleDeepScan}
            disabled={deepScanning}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-text-primary text-sm font-medium hover:border-accent/40 transition-colors disabled:opacity-40"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            {deepScanning ? 'Scanning…' : 'Deep Scan'}
          </button>
        )}
        {file.dr_score == null && isLocal && (
          <span className="flex items-center px-3 py-2 rounded-xl bg-warning/10 border border-warning/20 text-warning text-xs">
            ⚠ Fast-indexed — no DR or waveform yet. Use Deep Scan.
          </span>
        )}
      </div>
      {(playMsg || deepScanMsg) && (
        <p className="text-text-muted text-sm mb-4">{playMsg ?? deepScanMsg}</p>
      )}
      {browserPlayer.currentHash === hash && browserPlayer.signalPath && (
        <p className="text-text-muted text-xs font-mono mb-4">
          Browser decode: {browserPlayer.signalPath.sourceSampleRate}Hz → output {browserPlayer.signalPath.outputSampleRate}Hz{' '}
          {browserPlayer.signalPath.bitPerfect ? (
            <span className="text-success">● bit-perfect</span>
          ) : (
            <span className="text-warning">⚠ resampled by the browser</span>
          )}
        </p>
      )}
      {browserPlayer.error && browserPlayer.currentHash === null && (
        <p className="text-danger text-xs mb-4">{browserPlayer.error}</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {(['info', 'history'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'text-accent border-accent'
                : 'text-text-muted border-transparent hover:text-text-primary'
            }`}
          >
            {t === 'history' ? 'Engram History' : 'File Info'}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <>
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
                <InfoRow label="AccurateRip" value={
                  file.accuraterip_status === 'verified' ? <span className="text-success">✓ Verified</span> :
                  file.accuraterip_status === 'mismatch' ? <span className="text-danger">✗ Mismatch</span> :
                  file.accuraterip_status === 'not_found' ? <span className="text-text-muted">Not in database</span> :
                  file.accuraterip_status === 'computed' ? <span className="text-text-muted">CRC computed (no disc context)</span> :
                  <span className="text-text-muted">—</span>
                } />
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
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-success/10 border border-success/20 text-success text-sm">✓ Clean</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">✗ Issues detected</span>
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
                  {isLocal ? 'Waveform not generated yet — run a Deep Scan.' : 'Waveform not available for SMB sources.'}
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/waveforms/${hash}`} alt="Waveform" className="w-full" onError={() => setWaveformError(true)} />
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
                    {file.song_artist && <p className="text-text-muted text-sm mt-0.5">{file.song_artist}</p>}
                  </div>
                  <Link href={`/song/${file.song_id}`} className="px-3 py-1.5 rounded-lg bg-accent/20 border border-accent/30 text-accent text-xs font-medium hover:bg-accent/30 transition-colors">
                    View song →
                  </Link>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-2 border border-border text-text-muted text-sm">Unmatched</span>
                  <button onClick={handleMatch} disabled={matching} className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-text-primary text-xs font-medium hover:bg-surface transition-colors disabled:opacity-50">
                    {matching ? 'Matching…' : 'Match via AcoustID'}
                  </button>
                </div>
              )}
              {matchMsg && <p className="text-text-muted text-xs mt-3">{matchMsg}</p>}
            </div>
          </div>

          {/* Fingerprint */}
          {file.fingerprint && (
            <div>
              <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">AcoustID Fingerprint</h2>
              <div className="bg-surface rounded-xl border border-border p-4">
                <p className="text-text-muted text-xs font-mono break-all">
                  {file.fingerprint.slice(0, 80)}{file.fingerprint.length > 80 ? '…' : ''}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-text-muted text-sm">Metadata snapshots recorded by Engram.</p>
          </div>
          <EngramHistory hash={hash} />
        </div>
      )}
    </div>
  )
}
