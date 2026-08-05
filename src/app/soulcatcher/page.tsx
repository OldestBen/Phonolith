'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { C, col, cell, DataTable, type TableCell } from '@/components/panel'

// ── Types ─────────────────────────────────────────────────────────────────────
// Mirrors src/lib/soulcatcher.ts's SoulseekFile / the search route's response
// shape. hasFreeUploadSlot/queueLength/uploadSpeed are reported by slskd at
// the peer (response) level and copied onto each file server-side.
interface SoulseekResult {
  username: string
  filename: string
  size: number
  bitRate?: number
  length?: number
  sampleRate?: number
  bitDepth?: number
  extension?: string
  hasFreeUploadSlot?: boolean
  queueLength?: number
  uploadSpeed?: number
}

// Mirrors the downloads route's response shape. bytes_transferred/percent
// are transient — only present while slskd still has the transfer live.
interface SoulcatcherDownload {
  id: number
  query: string
  username: string
  filename: string
  size_bytes: number
  status: 'queued' | 'downloading' | 'completed' | 'failed'
  local_path: string | null
  requested_at: string
  completed_at: string | null
  bytes_transferred?: number
  percent?: number
}

interface SlskdStatus {
  online: boolean
  version?: string
}

interface FilterState {
  flac: boolean
  hi16: boolean
  freeSlots: boolean
  excludeUpscales: boolean
}

const DEFAULT_FILTERS: FilterState = {
  flac: true,
  hi16: true,
  freeSlots: false,
  excludeUpscales: true,
}

const FILTER_DEFS: { key: keyof FilterState; label: string }[] = [
  { key: 'flac', label: 'FLAC only' },
  { key: 'hi16', label: '≥ 16-bit' },
  { key: 'freeSlots', label: 'Free slots' },
  { key: 'excludeUpscales', label: 'Exclude upscales' },
]

// ── Formatting helpers ────────────────────────────────────────────────────────

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${mb % 1 === 0 ? mb.toFixed(0) : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} kB/s`
  return `${Math.round(bytesPerSec)} B/s`
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')} left`
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

// Fmt column label, e.g. "FLAC 24/96" — built from the real extension /
// bitDepth / sampleRate slskd reports, not fabricated.
function fmtLabel(r: SoulseekResult): string {
  if (!r.extension) return '—'
  const ext = r.extension.toUpperCase()
  if (r.bitDepth && r.sampleRate) {
    const khz = r.sampleRate % 1000 === 0 ? (r.sampleRate / 1000).toFixed(0) : (r.sampleRate / 1000).toFixed(1)
    return `${ext} ${r.bitDepth}/${khz}`
  }
  if (r.bitRate) return `${ext} ${Math.round(r.bitRate / 1000) || r.bitRate}`
  return ext
}

function fmtBadgeStyle(r: SoulseekResult): React.CSSProperties {
  const hiRes = (r.bitDepth != null && r.bitDepth >= 24) || r.extension === 'dsf'
  const lossy = r.extension === 'mp3' || r.extension === 'aac' || r.extension === 'm4a'
  return {
    borderRadius: 4,
    padding: '1px 5px',
    fontSize: 10,
    background: hiRes ? 'rgba(109,40,217,.3)' : lossy ? 'rgba(120,53,15,.4)' : '#27272a',
    color: hiRes ? '#c4b5fd' : lossy ? '#fbbf24' : C.dim,
  }
}

// Mockup's Size/Br/Slots/Speed/Q table cells each carry an explicit
// `font-size:10.5px` (smaller than the table's 11.5px base) that Peer/File
// don't — DataTable applies one uniform size to every cell, so we reproduce
// the per-column override here at the call site instead of touching the
// shared primitive.
function sm(v: ReactNode): ReactNode {
  return <span style={{ fontSize: 10.5 }}>{v}</span>
}

// A segmented (dashed) progress fill — mirrors the mockup's seg().
function segStyle(color: string, pct: number): React.CSSProperties {
  return {
    height: '100%',
    width: `${Math.max(0, Math.min(100, pct))}%`,
    background: `repeating-linear-gradient(90deg, ${color} 0 4px, rgba(0,0,0,0) 4px 6px)`,
    filter: `drop-shadow(0 0 4px ${color}99)`,
  }
}

function transferStateColor(status: SoulcatcherDownload['status']): string {
  switch (status) {
    case 'completed': return C.green
    case 'failed': return C.red
    case 'downloading': return C.vio
    default: return C.faint
  }
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: SlskdStatus | null }) {
  const online = status?.online ?? false
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-text-faint">
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: online ? C.green : C.faint, boxShadow: online ? `0 0 7px ${C.green}` : 'none' }}
      />
      {online ? `slskd connected${status?.version ? ` · v${status.version}` : ''}` : 'slskd offline'}
    </span>
  )
}

function SearchBar({
  query,
  onChange,
  onSubmit,
  searching,
}: {
  query: string
  onChange: (v: string) => void
  onSubmit: () => void
  searching: boolean
}) {
  const [focused, setFocused] = useState(false)
  const showFlourish = !focused && query.length === 0

  return (
    <div className="relative max-w-[440px] flex-1">
      <span
        className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-[11px] text-text-ghost"
        style={searching ? { animation: 'panel-pulse 1s ease-in-out infinite', color: C.vio } : undefined}
      >
        ⌕
      </span>
      <input
        type="text"
        value={query}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSubmit()
        }}
        aria-label="Search Soulseek"
        className="w-full rounded-[7px] bg-[#131316] py-[7px] pl-[26px] pr-3 text-[11.5px] transition-shadow focus:outline-none"
        style={{
          border: `1px solid ${focused ? '#6d28d9' : '#3f3f46'}`,
          boxShadow: focused ? '0 0 0 3px rgba(109,40,217,.16)' : 'none',
          color: showFlourish ? 'transparent' : '#e4e4e7',
        }}
      />
      {showFlourish && (
        <span className="pointer-events-none absolute left-[26px] top-1/2 -translate-y-1/2 text-[11.5px] text-text-ghost">
          Search artist, album, or track…
          <span style={{ color: C.vio, animation: 'panel-blink 1.1s steps(1) infinite' }}>▌</span>
        </span>
      )}
    </div>
  )
}

function FilterChips({ filters, onToggle }: { filters: FilterState; onToggle: (key: keyof FilterState) => void }) {
  return (
    <>
      {FILTER_DEFS.map(f => {
        const on = filters[f.key]
        return (
          <button
            key={f.key}
            onClick={() => onToggle(f.key)}
            className="shrink-0 rounded-[20px] px-[9px] py-[5px] text-[10.5px] transition-colors"
            style={{
              border: `1px solid ${on ? '#7c3aed' : '#27272a'}`,
              background: on ? 'rgba(109,40,217,.28)' : '#18181b',
              color: on ? '#c4b5fd' : C.dim,
            }}
          >
            {f.label}
          </button>
        )
      })}
    </>
  )
}

function QueueButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-[5px] border border-[#3f3f46] bg-surface px-2 py-0.5 text-[10px] text-accent-bright transition-colors hover:border-accent-dim hover:bg-[rgba(109,40,217,.25)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? '…' : 'Queue'}
    </button>
  )
}

// ── Right-rail panels ─────────────────────────────────────────────────────────

function TransfersPanel({
  downloads,
  speeds,
}: {
  downloads: SoulcatcherDownload[]
  speeds: Map<number, number>
}) {
  const active = downloads.filter(d => d.status === 'queued' || d.status === 'downloading')
  const totalSpeed = active.reduce((sum, d) => sum + (speeds.get(d.id) ?? 0), 0)

  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="m-0 text-[9px] uppercase tracking-[.2em] text-text-ghost">Transfers</p>
        <span className="text-[10px] text-text-faint">
          {active.length} active{totalSpeed > 0 ? ` · ${formatSpeed(totalSpeed)}` : ''}
        </span>
      </div>

      {active.length === 0 ? (
        <p className="m-0 text-[10.5px] text-text-ghost">No active transfers.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {active.map(t => {
            const pct = t.percent ?? 0
            const color = transferStateColor(t.status)
            const speed = speeds.get(t.id)
            const remaining = t.size_bytes - (t.bytes_transferred ?? 0)
            const eta = speed && speed > 0 ? formatEta(remaining / speed) : ''
            const meta =
              t.status === 'downloading'
                ? [pct ? `${pct}%` : null, speed ? formatSpeed(speed) : null, eta || null].filter(Boolean).join(' · ')
                : 'queued'
            return (
              <div key={t.id}>
                <div className="mb-1 flex justify-between gap-2">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-text-secondary">
                    {basename(t.filename)}
                  </span>
                  <span className="shrink-0 text-[10px]" style={{ color }}>
                    {t.status}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-[3px] bg-surface">
                  <div style={segStyle(color, pct)} />
                </div>
                <div className="mt-[3px] flex justify-between text-[9.5px] text-[#3f3f46]">
                  <span>{t.username}</span>
                  <span>{meta}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface PostStep {
  label: string
  done: boolean
  current: boolean
  failed?: boolean
}

function PostTransferPanel({
  download,
  onIngest,
  ingesting,
}: {
  download: SoulcatcherDownload | null
  onIngest: () => void
  ingesting: boolean
}) {
  const steps: PostStep[] = download
    ? [
        { label: 'Queued for transfer', done: true, current: false },
        {
          label: 'Downloading',
          done: download.status === 'completed' || download.status === 'failed',
          current: download.status === 'downloading',
          failed: download.status === 'failed',
        },
        {
          label: 'Transfer complete',
          done: download.status === 'completed',
          current: false,
          failed: download.status === 'failed',
        },
        {
          label: 'Added to library',
          done: !!download.local_path,
          current: download.status === 'completed' && !download.local_path,
        },
      ]
    : []

  const canIngest = !!download && download.status === 'completed' && !download.local_path

  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
      <p className="m-0 mb-[9px] text-[9px] uppercase tracking-[.2em] text-text-ghost">Post-transfer</p>

      {!download ? (
        <p className="m-0 text-[10.5px] text-text-ghost">Queue a download to see its progress here.</p>
      ) : (
        <div className="flex flex-col gap-[7px]">
          <p className="m-0 mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-faint">
            {basename(download.filename)}
          </p>
          {steps.map(s => {
            const color = s.failed ? C.red : s.done ? C.green : s.current ? C.vio : C.faint
            const state = s.failed ? 'failed' : s.done ? 'done' : s.current ? 'running' : 'pending'
            return (
              <div key={s.label} className="flex items-center gap-2">
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                />
                <span className="flex-1 text-[10.5px] text-text-secondary">{s.label}</span>
                <span className="text-[9.5px] text-text-ghost">{state}</span>
              </div>
            )
          })}
        </div>
      )}

      <button
        onClick={onIngest}
        disabled={!canIngest || ingesting}
        className="mt-[11px] w-full rounded-md px-[10px] py-1.5 text-[10.5px] font-medium text-white shadow-[0_0_16px_rgba(109,40,217,.45)] transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        style={{ background: '#6d28d9' }}
      >
        {download?.local_path
          ? 'Added to library'
          : ingesting
          ? 'Scanning…'
          : 'Add to Library — rescan /downloads'}
      </button>
    </div>
  )
}

function HistoryPanel({ downloads }: { downloads: SoulcatcherDownload[] }) {
  const history = downloads
    .filter(d => (d.status === 'completed' || d.status === 'failed') && d.completed_at)
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
    .slice(0, 8)

  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
      <p className="m-0 mb-[9px] text-[9px] uppercase tracking-[.2em] text-text-ghost">History</p>
      {history.length === 0 ? (
        <p className="m-0 text-[10.5px] text-text-ghost">Nothing finished yet.</p>
      ) : (
        history.map(h => (
          <div key={h.id} className="flex justify-between gap-2 py-[3px] text-[10.5px]">
            <span
              className="overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ color: h.status === 'failed' ? C.red : C.dim }}
            >
              {basename(h.filename)}
            </span>
            <span className="shrink-0 text-text-ghost">{timeAgo(h.completed_at!)}</span>
          </div>
        ))
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SoulcatcherPage() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SoulseekResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)

  const [downloads, setDownloads] = useState<SoulcatcherDownload[]>([])
  const [ingestingId, setIngestingId] = useState<number | null>(null)
  const [speeds, setSpeeds] = useState<Map<number, number>>(new Map())

  const [status, setStatus] = useState<SlskdStatus | null>(null)

  // Previous poll's {bytes, time} per download id, used to derive a real
  // instantaneous transfer speed from two consecutive real byte counts
  // rather than fabricating one.
  const prevSnapshot = useRef<Map<number, { bytes: number; time: number }>>(new Map())

  const fetchStatus = useCallback(() => {
    fetch('/api/soulcatcher/status')
      .then(r => (r.ok ? r.json() : { online: false }))
      .then(setStatus)
      .catch(() => setStatus({ online: false }))
  }, [])

  const fetchDownloads = useCallback(() => {
    fetch('/api/soulcatcher/downloads')
      .then(r => (r.ok ? r.json() : { downloads: [] }))
      .then(data => {
        const list: SoulcatcherDownload[] = data.downloads ?? []
        setDownloads(list)

        const now = Date.now()
        const nextSpeeds = new Map<number, number>()
        for (const d of list) {
          if (d.status !== 'downloading' || d.bytes_transferred == null) continue
          const prev = prevSnapshot.current.get(d.id)
          if (prev && now > prev.time) {
            const deltaBytes = d.bytes_transferred - prev.bytes
            const deltaSec = (now - prev.time) / 1000
            if (deltaBytes >= 0 && deltaSec > 0) nextSpeeds.set(d.id, deltaBytes / deltaSec)
          }
          prevSnapshot.current.set(d.id, { bytes: d.bytes_transferred, time: now })
        }
        setSpeeds(nextSpeeds)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchDownloads()
  }, [fetchStatus, fetchDownloads])

  // Poll downloads + status while anything is queued/downloading.
  useEffect(() => {
    const active = downloads.some(d => d.status === 'queued' || d.status === 'downloading')
    if (!active) return
    const id = setInterval(fetchDownloads, 3000)
    return () => clearInterval(id)
  }, [downloads, fetchDownloads])

  const activeCount = downloads.filter(d => d.status === 'queued' || d.status === 'downloading').length
  usePageHeader('Soulcatcher', `slskd sidecar · ${activeCount} active transfer${activeCount === 1 ? '' : 's'}`)

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      const r = await fetch(`/api/soulcatcher/search?q=${encodeURIComponent(q)}`)
      if (!r.ok) throw new Error('Search failed')
      const data = await r.json()
      const list: SoulseekResult[] = data.results ?? []
      setResults(list)
      if (list.length === 0) {
        setSearchError('No results — slskd may be offline or no peers have this file.')
      }
    } catch {
      setResults([])
      setSearchError('Search failed — check that the slskd sidecar is running.')
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleDownload = async (result: SoulseekResult) => {
    const key = `${result.username}:${result.filename}`
    setDownloadingKey(key)
    try {
      const r = await fetch('/api/soulcatcher/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: result.username,
          filename: result.filename,
          size: result.size,
          query: query.trim(),
        }),
      })
      if (r.ok) fetchDownloads()
    } catch {
      // surfaced implicitly via downloads list not updating
    } finally {
      setDownloadingKey(null)
    }
  }

  const handleIngest = async (download: SoulcatcherDownload) => {
    setIngestingId(download.id)
    try {
      await fetch(`/api/soulcatcher/downloads/${download.id}/ingest`, { method: 'POST' })
      fetchDownloads()
    } catch {
      // no-op — user can retry
    } finally {
      setIngestingId(null)
    }
  }

  const toggleFilter = (key: keyof FilterState) => setFilters(prev => ({ ...prev, [key]: !prev[key] }))

  const filteredResults = results.filter(r => {
    if (filters.flac && r.extension !== 'flac') return false
    if (filters.hi16 && r.bitDepth != null && r.bitDepth < 16) return false
    if (filters.freeSlots && r.hasFreeUploadSlot !== true) return false
    if (filters.excludeUpscales && /upscale/i.test(r.filename)) return false
    return true
  })

  const cols = [
    col('Peer'),
    col('File'),
    col('Fmt'),
    col('Size'),
    col('Br'),
    col('Slots'),
    col('Speed'),
    col('Q'),
    col('', 'right'),
  ]

  const rows: TableCell[][] = filteredResults.map(r => {
    const key = `${r.username}:${r.filename}`
    const slots =
      r.hasFreeUploadSlot === undefined
        ? cell(sm('—'), C.faint)
        : cell(sm(r.hasFreeUploadSlot ? 'Free' : 'Busy'), r.hasFreeUploadSlot ? C.green : C.red)

    return [
      cell(r.username, C.txt),
      cell(<span title={r.filename}>{basename(r.filename)}</span>, C.dim),
      cell(<span style={fmtBadgeStyle(r)}>{fmtLabel(r)}</span>),
      cell(sm(formatSize(r.size)), C.dim),
      cell(sm(r.bitRate ? `${r.bitRate}k` : '—'), C.mut),
      slots,
      cell(sm(r.uploadSpeed != null ? formatSpeed(r.uploadSpeed) : '—'), C.dim),
      cell(sm(r.queueLength != null ? String(r.queueLength) : '—'), C.mut),
      cell(<QueueButton onClick={() => handleDownload(r)} busy={downloadingKey === key} />, undefined, 'right'),
    ]
  })

  const mostRecentDownload = downloads[0] ?? null

  return (
    <div className="flex flex-col gap-3 px-5 pb-[22px] pt-[18px]">
      {/* Search bar + filters + status */}
      <div className="flex items-center gap-2.5">
        <SearchBar query={query} onChange={setQuery} onSubmit={handleSearch} searching={searching} />
        <FilterChips filters={filters} onToggle={toggleFilter} />
        <div className="flex-1" />
        <StatusPill status={status} />
      </div>

      {searchError && <p className="m-0 text-[10.5px] text-text-faint">{searchError}</p>}

      {/* Results table + right rail */}
      <div className="grid grid-cols-[minmax(0,1fr)_316px] items-start gap-3.5">
        <DataTable cols={cols} rows={rows} />

        <div className="flex flex-col gap-3">
          <TransfersPanel downloads={downloads} speeds={speeds} />
          <PostTransferPanel
            download={mostRecentDownload}
            onIngest={() => mostRecentDownload && handleIngest(mostRecentDownload)}
            ingesting={mostRecentDownload != null && ingestingId === mostRecentDownload.id}
          />
          <HistoryPanel downloads={downloads} />
        </div>
      </div>
    </div>
  )
}
