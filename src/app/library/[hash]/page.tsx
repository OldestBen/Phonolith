'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { LibraryFile, MetadataVersion } from '@/lib/types'
import { useBrowserPlayer } from '@/contexts/BrowserPlayerContext'

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

// ── Pressing info (Discogs) ──────────────────────────────────────────────────
interface DiscogsPressing {
  title?: string
  country?: string
  released?: string
  labels?: Array<{ name: string; catno: string }>
  formats?: Array<{ name: string; qty?: string; descriptions?: string[] }>
}

function PressingInfo({ hash }: { hash: string }) {
  const [pressing, setPressing] = useState<DiscogsPressing | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [looked, setLooked] = useState(false)

  const handleLookup = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const r = await fetch(`/api/library/${hash}/pressing`)
      const data = await r.json()
      if (data.pressing) {
        setPressing(data.pressing)
      } else {
        setMsg(data.error ?? 'No pressing info found on Discogs.')
      }
    } catch {
      setMsg('Pressing lookup failed.')
    } finally {
      setLooked(true)
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">Pressing Info</h2>
      <div className="bg-surface rounded-xl border border-border p-4">
        {pressing ? (
          <>
            <InfoRow label="Country" value={pressing.country ?? '—'} />
            <InfoRow label="Released" value={pressing.released ?? '—'} />
            <InfoRow label="Label" value={pressing.labels?.map(l => l.name).join(', ') || '—'} />
            <InfoRow label="Catalog #" value={pressing.labels?.map(l => l.catno).join(', ') || '—'} />
            <InfoRow label="Format" value={pressing.formats?.map(f => [f.name, ...(f.descriptions ?? [])].join(', ')).join(' / ') || '—'} />
          </>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-sm">{looked ? (msg ?? 'No pressing info found.') : 'Not looked up yet.'}</span>
            <button onClick={handleLookup} disabled={loading} className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-text-primary text-xs font-medium hover:bg-surface transition-colors disabled:opacity-50">
              {loading ? 'Looking up…' : 'Look Up Pressing'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Metadata edit form ─────────────────────────────────────────────────────────
interface MetadataEditFields {
  title: string
  artist: string
  album: string
  year: string
  track_number: string
  disc_number: string
}

function fieldsFromFile(file: LibraryFile): MetadataEditFields {
  return {
    title: file.title ?? '',
    artist: file.artist ?? '',
    album: file.album ?? '',
    year: file.year ?? '',
    track_number: file.track_number?.toString() ?? '',
    disc_number: file.disc_number?.toString() ?? '',
  }
}

function MetadataEditButton({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-text-primary text-xs font-medium hover:bg-surface transition-colors"
    >
      {editing ? 'Close' : 'Edit Metadata'}
    </button>
  )
}

function MetadataEditForm({ hash, file, isLocal, onSaved, onClose }: {
  hash: string
  file: LibraryFile
  isLocal: boolean
  onSaved: (file: LibraryFile) => void
  onClose: () => void
}) {
  const [fields, setFields] = useState<MetadataEditFields>(fieldsFromFile(file))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { setFields(fieldsFromFile(file)) }, [file])

  const handleField = (key: keyof MetadataEditFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields(f => ({ ...f, [key]: e.target.value }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const body: Record<string, unknown> = {
        title: fields.title.trim() || null,
        artist: fields.artist.trim() || null,
        album: fields.album.trim() || null,
        year: fields.year.trim() || null,
        track_number: fields.track_number.trim() ? parseInt(fields.track_number, 10) : null,
        disc_number: fields.disc_number.trim() ? parseInt(fields.disc_number, 10) : null,
      }
      const r = await fetch(`/api/library/${hash}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (r.ok) {
        onSaved({ ...file, ...body, metadata_locked: true } as LibraryFile)
        setMsg(data.writeback_warning ? `Saved — ${data.writeback_warning}` : 'Saved.')
        onClose()
      } else {
        setMsg(data.error ?? 'Save failed')
      }
    } catch {
      setMsg('Save failed')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 8000)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mb-4">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="text-xs">
          <span className="text-text-muted block mb-1">Title</span>
          <input value={fields.title} onChange={handleField('title')} className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 w-full focus:outline-none focus:border-accent transition-colors" />
        </label>
        <label className="text-xs">
          <span className="text-text-muted block mb-1">Artist</span>
          <input value={fields.artist} onChange={handleField('artist')} className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 w-full focus:outline-none focus:border-accent transition-colors" />
        </label>
        <label className="text-xs">
          <span className="text-text-muted block mb-1">Album</span>
          <input value={fields.album} onChange={handleField('album')} className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 w-full focus:outline-none focus:border-accent transition-colors" />
        </label>
        <label className="text-xs">
          <span className="text-text-muted block mb-1">Year</span>
          <input value={fields.year} onChange={handleField('year')} className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 w-full focus:outline-none focus:border-accent transition-colors" />
        </label>
        <label className="text-xs">
          <span className="text-text-muted block mb-1">Track #</span>
          <input value={fields.track_number} onChange={handleField('track_number')} className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 w-full focus:outline-none focus:border-accent transition-colors" />
        </label>
        <label className="text-xs">
          <span className="text-text-muted block mb-1">Disc #</span>
          <input value={fields.disc_number} onChange={handleField('disc_number')} className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 w-full focus:outline-none focus:border-accent transition-colors" />
        </label>
      </div>
      {!isLocal && (
        <p className="text-text-muted text-xs mb-3">This file is on a network share — embedded tag write-back is skipped, only the database override is saved.</p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { onClose(); setFields(fieldsFromFile(file)) }} disabled={saving} className="px-3 py-1.5 rounded-lg border border-border text-text-muted text-xs hover:text-text-primary transition-colors disabled:opacity-50">
          Cancel
        </button>
        {msg && <span className="text-text-muted text-xs">{msg}</span>}
      </div>
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
  const [editingMeta, setEditingMeta] = useState(false)
  const browserPlayer = useBrowserPlayer()

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
        <button
          onClick={handleDeepScan}
          disabled={deepScanning}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-text-primary text-sm font-medium hover:border-accent/40 transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          {deepScanning ? 'Scanning…' : 'Deep Scan'}
        </button>
        {file.dr_score == null && (
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
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-text-muted text-xs uppercase tracking-widest font-medium">File Info</h2>
                <MetadataEditButton editing={editingMeta} onClick={() => setEditingMeta(e => !e)} />
              </div>
              {editingMeta && (
                <MetadataEditForm
                  hash={hash}
                  file={file}
                  isLocal={isLocal}
                  onSaved={setFile}
                  onClose={() => setEditingMeta(false)}
                />
              )}
              <div className="bg-surface rounded-xl border border-border p-4">
                <InfoRow label="Title" value={file.title ?? '—'} />
                <InfoRow label="Artist" value={file.artist ?? '—'} />
                <InfoRow label="Album" value={file.album ?? '—'} />
                <InfoRow label="Year" value={file.year ?? '—'} />
                <InfoRow label="Track / Disc" value={`${file.track_number ?? '—'} / ${file.disc_number ?? 1}`} />
                {file.metadata_locked && (
                  <InfoRow label="Metadata" value={<span className="text-accent text-xs">🔒 Locked (manual override)</span>} />
                )}
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
                  Waveform not generated yet — run a Deep Scan.
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
            <div className="mb-8">
              <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">AcoustID Fingerprint</h2>
              <div className="bg-surface rounded-xl border border-border p-4">
                <p className="text-text-muted text-xs font-mono break-all">
                  {file.fingerprint.slice(0, 80)}{file.fingerprint.length > 80 ? '…' : ''}
                </p>
              </div>
            </div>
          )}

          {/* Pressing info */}
          <PressingInfo hash={hash} />
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
