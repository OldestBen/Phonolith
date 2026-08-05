'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LibraryFile, AlbumSummary } from '@/lib/types'
import AlbumTile from '@/components/AlbumTile'
import { useBrowserPlayer } from '@/contexts/BrowserPlayerContext'
import { useAnalysisQueue } from '@/hooks/useAnalysisQueue'
import BulkActionBar from '@/components/BulkActionBar'

// ── Helpers ───────────────────────────────────────────────────────────────────
function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function formatFormat(file: { format?: string; bit_depth?: number; sample_rate?: number }): string {
  const parts = [file.format?.toUpperCase()]
  if (file.bit_depth && file.sample_rate) {
    parts.push(`${file.bit_depth}/${Math.round(file.sample_rate / 1000)}`)
  }
  return parts.filter(Boolean).join(' ')
}

function formatDuration(ms?: number): string {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function DrScore({ score }: { score?: number }) {
  if (score == null) return <span className="text-text-muted">—</span>
  const cls = score > 12 ? 'text-success' : score >= 8 ? 'text-warning' : 'text-danger'
  return <span className={cls}>{score}</span>
}

function FileRow({
  file,
  selected,
  onToggle,
  onOpen,
}: {
  file: LibraryFile
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const player = useBrowserPlayer()
  const isPlaying = player.currentHash === file.blake3_hash && player.isPlaying

  return (
    <tr
      onClick={onOpen}
      className="border-b border-border/50 hover:bg-surface-2 cursor-pointer transition-colors"
    >
      <td className="py-2 pl-1 pr-2 w-8" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} className="w-3.5 h-3.5 accent-accent cursor-pointer" />
      </td>
      <td className="py-2 pr-3 w-8" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => isPlaying ? player.pause() : player.playQueue([file.blake3_hash])}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
          title={isPlaying ? 'Pause' : 'Play in browser'}
        >
          {isPlaying
            ? <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          }
        </button>
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-text-primary max-w-xs truncate">
        {basename(file.file_path)}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{formatFormat(file) || '—'}</td>
      <td className="py-2.5 pr-4 font-mono">
        <DrScore score={file.dr_score} />
      </td>
      <td className="py-2.5 pr-4">
        {file.spectral_ok == null ? (
          <span className="text-text-muted">—</span>
        ) : file.spectral_ok ? (
          <span className="text-success">✓</span>
        ) : (
          <span className="text-danger">✗</span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">
        {file.song_title
          ? `${file.song_title}${file.song_artist ? ` — ${file.song_artist}` : ''}`
          : <span className="text-text-muted/50">—</span>
        }
      </td>
      <td className="py-2.5" onClick={e => e.stopPropagation()}>
        <Link
          href={`/library/${file.blake3_hash}`}
          className="text-xs text-text-muted hover:text-accent transition-colors"
        >
          Details →
        </Link>
      </td>
    </tr>
  )
}

// ── Songs tab: one row per matched song, not one row per file ─────────────────
interface SongRow {
  song_id: number
  song_title: string
  release_date: string | null
  artist_name: string
  album_id: number | null
  album_name: string | null
  blake3_hash: string
  format?: string
  dr_score?: number
  bit_depth?: number
  sample_rate?: number
  duration_ms?: number
  spectral_ok?: boolean
  is_preferred: boolean
  file_count: string | number
}

function SongRowView({
  song,
  selected,
  onToggle,
  onOpen,
}: {
  song: SongRow
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <tr onClick={onOpen} className="border-b border-border/50 hover:bg-surface-2 cursor-pointer transition-colors">
      <td className="py-2 pl-1 pr-2 w-8" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} className="w-3.5 h-3.5 accent-accent cursor-pointer" />
      </td>
      <td className="py-2.5 pr-4 text-sm text-text-primary max-w-xs truncate">{song.song_title}</td>
      <td className="py-2.5 pr-4 text-text-muted truncate max-w-[200px]">{song.artist_name}</td>
      <td className="py-2.5 pr-4 text-text-muted truncate max-w-[200px]">
        {song.album_id ? (
          <Link href={`/library/album?id=${song.album_id}`} onClick={e => e.stopPropagation()} className="hover:text-accent transition-colors">
            {song.album_name}
          </Link>
        ) : (song.album_name ?? '—')}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{formatFormat(song)}</td>
      <td className="py-2.5 pr-4 font-mono"><DrScore score={song.dr_score} /></td>
      <td className="py-2.5 pr-4 text-text-muted font-mono">{formatDuration(song.duration_ms)}</td>
      <td className="py-2.5 pr-4 text-text-muted text-xs">
        {Number(song.file_count) > 1 ? `${song.file_count} versions` : ''}
      </td>
      <td className="py-2.5" onClick={e => e.stopPropagation()}>
        <Link href={`/song/${song.song_id}`} className="text-xs text-text-muted hover:text-accent transition-colors">
          Details →
        </Link>
      </td>
    </tr>
  )
}

// ── Library status ────────────────────────────────────────────────────────────
interface ScanProgress {
  phase: 'idle' | 'discovering' | 'indexing'
  total: number
  done: number
  current_file: string | null
  source_name: string | null
}

interface LibraryStatus {
  last_scan?: string
  watcher_status?: string
  library_path?: string
  scanning?: boolean
  scan_progress?: ScanProgress
}

// ── Filter types ──────────────────────────────────────────────────────────────
type DRFilter = 'all' | 'high' | 'mid' | 'low'
type MatchFilter = 'all' | 'matched' | 'unmatched'
type ViewMode = 'albums' | 'songs' | 'files'
const PAGE_SIZE = 100

function LibraryPageInner() {
  const router = useRouter()

  const [view, setView] = useState<ViewMode>('albums')
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [libraryTotal, setLibraryTotal] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [activeScan, setActiveScan] = useState(false)
  const [deepScanning, setDeepScanning] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [autoDeep, setAutoDeep] = useState(true)
  const progressRef = useRef<HTMLDivElement>(null)

  // Albums tab
  const [albums, setAlbums] = useState<AlbumSummary[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(true)
  const [albumQuery, setAlbumQuery] = useState('')

  // Files tab — server-paginated/filtered now, not a full-table client fetch
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [filesTotal, setFilesTotal] = useState(0)
  const [filesOffset, setFilesOffset] = useState(0)
  const [filesLoading, setFilesLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [formatFilter, setFormatFilter] = useState<string>('all')
  const [drFilter, setDrFilter] = useState<DRFilter>('all')
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all')
  const filesQueue = useAnalysisQueue()

  // Songs tab
  const [songs, setSongs] = useState<SongRow[]>([])
  const [songsTotal, setSongsTotal] = useState(0)
  const [songsOffset, setSongsOffset] = useState(0)
  const [songsLoading, setSongsLoading] = useState(true)
  const [songQuery, setSongQuery] = useState('')
  const songsQueue = useAnalysisQueue()

  // Close progress popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (progressRef.current && !progressRef.current.contains(e.target as Node)) {
        setShowProgress(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Library status — polled independently of whichever tab is active, so the
  // header's file count and scan indicator are always real regardless of
  // pagination/filters on the Files/Songs tabs below.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/library/status')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (cancelled || !data) return
          setStatus(data)
          setActiveScan(!!data.scanning)
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, activeScan ? 3000 : 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeScan])

  // Load the auto-deep-analysis preference
  useEffect(() => {
    fetch('/api/settings/scan')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.autoDeepAnalysis === 'boolean') setAutoDeep(d.autoDeepAnalysis) })
      .catch(() => {})
  }, [])

  // The header's overall file count needs a real DB total independent of
  // whichever tab is active — the analyst's own status endpoint only
  // reports files touched since it last restarted (files_indexed), not a
  // persistent library-wide total, so it can't be used for this. Refetched
  // on mount and again whenever an active scan finishes.
  useEffect(() => {
    if (activeScan) return
    fetch('/api/library?limit=1')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (typeof data?.total === 'number') setLibraryTotal(data.total) })
      .catch(() => {})
  }, [activeScan])

  // Albums grid data — refetched when the search box changes (debounced)
  useEffect(() => {
    if (view !== 'albums') return
    setAlbumsLoading(true)
    const id = setTimeout(() => {
      const qs = albumQuery.trim() ? `?q=${encodeURIComponent(albumQuery.trim())}` : ''
      fetch(`/api/library/albums${qs}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setAlbums(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setAlbumsLoading(false))
    }, 200)
    return () => clearTimeout(id)
  }, [view, albumQuery])

  // Files tab — server-side search/filters/pagination (debounced on search
  // only; filter/offset changes fetch immediately).
  useEffect(() => {
    if (view !== 'files') return
    const id = setTimeout(() => {
      setFilesLoading(true)
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (formatFilter !== 'all') params.set('format', formatFilter)
      if (drFilter !== 'all') params.set('dr', drFilter)
      if (matchFilter !== 'all') params.set('match', matchFilter)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(filesOffset))
      fetch(`/api/library?${params.toString()}`)
        .then(r => r.ok ? r.json() : { files: [], total: 0 })
        .then(data => { setFiles(data.files ?? []); setFilesTotal(data.total ?? 0) })
        .catch(() => {})
        .finally(() => setFilesLoading(false))
    }, search ? 300 : 0)
    return () => clearTimeout(id)
  }, [view, search, formatFilter, drFilter, matchFilter, filesOffset])

  // Reset to page 1 whenever a filter/search changes
  useEffect(() => { setFilesOffset(0) }, [search, formatFilter, drFilter, matchFilter])

  // Songs tab — same server-side search/pagination pattern
  useEffect(() => {
    if (view !== 'songs') return
    const id = setTimeout(() => {
      setSongsLoading(true)
      const params = new URLSearchParams()
      if (songQuery.trim()) params.set('q', songQuery.trim())
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(songsOffset))
      fetch(`/api/library/songs?${params.toString()}`)
        .then(r => r.ok ? r.json() : { songs: [], total: 0 })
        .then(data => { setSongs(data.songs ?? []); setSongsTotal(data.total ?? 0) })
        .catch(() => {})
        .finally(() => setSongsLoading(false))
    }, songQuery ? 300 : 0)
    return () => clearTimeout(id)
  }, [view, songQuery, songsOffset])

  useEffect(() => { setSongsOffset(0) }, [songQuery])

  const handleDeepScan = async () => {
    setDeepScanning(true)
    setScanMsg(null)
    try {
      const r = await fetch('/api/library/deep-scan-pending', { method: 'POST' })
      const data = await r.json()
      setScanMsg(data.message ?? (data.ok ? 'Deep scan started.' : 'Deep scan failed.'))
      if (data.ok) setActiveScan(true)
    } catch {
      setScanMsg('Deep scan failed — check analyst sidecar.')
    } finally {
      setDeepScanning(false)
    }
  }

  const handleScan = async () => {
    setScanning(true)
    setScanMsg(null)
    try {
      const r = await fetch('/api/library/scan', { method: 'POST' })
      const data = await r.json()
      setScanMsg(data.message ?? 'Scan started.')
      setActiveScan(true)
    } catch {
      setScanMsg('Scan failed — check your library configuration.')
    } finally {
      setScanning(false)
    }
  }

  const toggleAutoDeep = async () => {
    const next = !autoDeep
    setAutoDeep(next) // optimistic
    try {
      const r = await fetch('/api/settings/scan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoDeepAnalysis: next }),
      })
      if (!r.ok) setAutoDeep(!next) // revert on failure
    } catch {
      setAutoDeep(!next)
    }
  }

  const formats = ['all', 'flac', 'mp3', 'alac', 'aac', 'wav', 'dsf', 'ogg']

  const totalFileCount = libraryTotal ?? filesTotal

  const activeQueue = view === 'songs' ? songsQueue : filesQueue

  return (
    <div className="min-h-screen px-4 py-8 pb-28 md:pb-8">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-text-primary text-xl font-bold">Library</h1>
          <div className="relative" ref={progressRef}>
            <button
              onClick={() => setShowProgress(o => !o)}
              className="px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted text-xs flex items-center gap-1.5 hover:border-accent/40 transition-colors"
            >
              {activeScan && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
              {totalFileCount} file{totalFileCount !== 1 ? 's' : ''}
              {activeScan && ' — scanning…'}
            </button>
            {showProgress && status && (
              <div className="absolute top-7 left-0 z-50 w-72 bg-surface border border-border rounded-xl shadow-2xl p-3 space-y-2">
                {activeScan && status.scan_progress ? (
                  <>
                    <p className="text-text-primary text-xs font-medium">
                      {status.scan_progress.source_name ? `Scanning ${status.scan_progress.source_name}` : 'Scan in progress'}
                    </p>
                    {status.scan_progress.phase === 'discovering' ? (
                      <p className="text-text-muted text-[11px]">Discovering… {status.scan_progress.done.toLocaleString()} found</p>
                    ) : status.scan_progress.total > 0 ? (
                      <>
                        <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-all duration-300"
                            style={{ width: `${Math.round((status.scan_progress.done / status.scan_progress.total) * 100)}%` }}
                          />
                        </div>
                        <p className="text-text-muted text-[11px]">{status.scan_progress.done.toLocaleString()} / {status.scan_progress.total.toLocaleString()}</p>
                      </>
                    ) : (
                      <p className="text-text-muted text-[11px] animate-pulse">Starting…</p>
                    )}
                    {status.scan_progress.current_file && (
                      <p className="text-text-muted text-[10px] font-mono truncate">{status.scan_progress.current_file.split(/[/\\]/).pop()}</p>
                    )}
                  </>
                ) : status.last_scan ? (
                  <>
                    <p className="text-text-primary text-xs font-medium">Last scan complete</p>
                    <p className="text-text-muted text-[11px]">{new Date(status.last_scan).toLocaleString()}</p>
                  </>
                ) : (
                  <p className="text-text-muted text-xs">No scan yet — click Scan Library to start.</p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {status?.last_scan && (
            <span className="text-text-muted text-xs">
              Last scan: {new Date(status.last_scan).toLocaleString()}
            </span>
          )}
          <button
            onClick={handleDeepScan}
            disabled={deepScanning || activeScan}
            title="Deep-analyse every file fast-indexed with no DR score yet"
            className="px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs font-medium
                       hover:bg-warning/20 transition-colors disabled:opacity-50"
          >
            {deepScanning ? 'Analysing…' : 'Analyse Unscanned'}
          </button>
          <button
            onClick={toggleAutoDeep}
            role="switch"
            aria-checked={autoDeep}
            title={autoDeep
              ? 'Deep analysis (DR, waveform, fingerprint) runs automatically after each scan. Click for fast-index only.'
              : 'Scans fast-index only; run deep analysis on demand with “Analyse Unscanned”. Click to run it automatically.'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border text-xs
                       text-text-muted hover:border-accent/40 transition-colors"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoDeep ? 'bg-accent' : 'bg-text-muted/40'}`} />
            Auto-analyse {autoDeep ? 'on' : 'off'}
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium
                       hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan Library'}
          </button>
        </div>
      </div>

      {scanMsg && (
        <div className="mb-4 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-sm">
          {scanMsg}
        </div>
      )}

      {/* View toggle + search */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-surface border border-border">
          <button
            onClick={() => setView('albums')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'albums' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Albums
          </button>
          <button
            onClick={() => setView('songs')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'songs' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Songs
          </button>
          <button
            onClick={() => setView('files')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'files' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Files
          </button>
        </div>

        <input
          type="text"
          value={view === 'albums' ? albumQuery : view === 'songs' ? songQuery : search}
          onChange={e => view === 'albums' ? setAlbumQuery(e.target.value) : view === 'songs' ? setSongQuery(e.target.value) : setSearch(e.target.value)}
          placeholder={view === 'albums' ? 'Search albums or artists…' : view === 'songs' ? 'Search songs, artists, or albums…' : 'Search files…'}
          className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 flex-1 min-w-[200px] max-w-sm
                     placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </div>

      {view === 'albums' ? (
        albumsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-pulse">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square bg-surface-2 rounded-xl" />
            ))}
          </div>
        ) : albums.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-text-muted text-base mb-2">
              {albumQuery
                ? 'No albums match your search.'
                : 'No albums indexed yet. Scan your library to populate this view.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {albums.map(a => (
              <AlbumTile key={a.album_id ?? `${a.artist}::${a.album}`} {...a} />
            ))}
          </div>
        )
      ) : view === 'songs' ? (
        <>
          {songsLoading ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 bg-surface-2 rounded" />)}
            </div>
          ) : songs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-text-muted text-base mb-2">
                {songQuery ? 'No songs match your search.' : 'No matched songs yet — songs appear here once files are matched to a real song.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-2 pl-1 w-8" />
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Title</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Artist</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Album</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Format</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">DR</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Time</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Versions</th>
                      <th className="text-left text-text-muted font-medium py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {songs.map(s => (
                      <SongRowView
                        key={s.song_id}
                        song={s}
                        selected={songsQueue.selected.has(s.blake3_hash)}
                        onToggle={() => songsQueue.toggle(s.blake3_hash)}
                        onOpen={() => router.push(`/song/${s.song_id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar total={songsTotal} offset={songsOffset} pageSize={PAGE_SIZE} onOffset={setSongsOffset} />
            </>
          )}
        </>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            <select
              value={formatFilter}
              onChange={e => setFormatFilter(e.target.value)}
              className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-1.5
                         focus:outline-none focus:border-accent"
            >
              {formats.map(f => (
                <option key={f} value={f}>{f === 'all' ? 'All formats' : f.toUpperCase()}</option>
              ))}
            </select>

            <select
              value={drFilter}
              onChange={e => setDrFilter(e.target.value as DRFilter)}
              className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-1.5
                         focus:outline-none focus:border-accent"
            >
              <option value="all">All DR scores</option>
              <option value="high">High DR (&gt;12)</option>
              <option value="mid">Mid DR (8–12)</option>
              <option value="low">Low DR (&lt;8)</option>
            </select>

            <select
              value={matchFilter}
              onChange={e => setMatchFilter(e.target.value as MatchFilter)}
              className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-1.5
                         focus:outline-none focus:border-accent"
            >
              <option value="all">All files</option>
              <option value="matched">Matched only</option>
              <option value="unmatched">Unmatched only</option>
            </select>
          </div>

          {/* Table */}
          {filesLoading ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface-2 rounded" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-text-muted text-base mb-2">
                {filesTotal === 0 && !search && formatFilter === 'all' && drFilter === 'all' && matchFilter === 'all'
                  ? 'No files indexed. Mount a music directory and click Scan Library.'
                  : 'No files match the current filters.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-2 pl-1 w-8" />
                      <th className="py-2 w-8" />
                      <th className="text-left text-text-muted font-medium py-2 pr-4">File</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Format</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">DR</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Quality</th>
                      <th className="text-left text-text-muted font-medium py-2 pr-4">Matched Song</th>
                      <th className="text-left text-text-muted font-medium py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map(file => (
                      <FileRow
                        key={file.blake3_hash}
                        file={file}
                        selected={filesQueue.selected.has(file.blake3_hash)}
                        onToggle={() => filesQueue.toggle(file.blake3_hash)}
                        onOpen={() => router.push(`/library/${file.blake3_hash}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar total={filesTotal} offset={filesOffset} pageSize={PAGE_SIZE} onOffset={setFilesOffset} />
            </>
          )}
        </>
      )}

      <BulkActionBar
        count={activeQueue.total}
        queueState={activeQueue.queueState}
        queued={activeQueue.queued}
        failed={activeQueue.failed}
        onQueue={activeQueue.queueAnalysis}
        onClear={activeQueue.clear}
      />
    </div>
  )
}

function PaginationBar({
  total,
  offset,
  pageSize,
  onOffset,
}: {
  total: number
  offset: number
  pageSize: number
  onOffset: (offset: number) => void
}) {
  const page = Math.floor(offset / pageSize) + 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 text-xs text-text-muted">
      <span>Page {page} of {pageCount} · {total.toLocaleString()} total</span>
      <div className="flex gap-2">
        <button
          onClick={() => onOffset(Math.max(0, offset - pageSize))}
          disabled={offset === 0}
          className="px-2.5 py-1 rounded-md bg-surface-2 border border-border disabled:opacity-40 hover:border-accent/40 transition-colors"
        >
          ← Prev
        </button>
        <button
          onClick={() => onOffset(offset + pageSize)}
          disabled={offset + pageSize >= total}
          className="px-2.5 py-1 rounded-md bg-surface-2 border border-border disabled:opacity-40 hover:border-accent/40 transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-muted">Loading…</div>
      </div>
    }>
      <LibraryPageInner />
    </Suspense>
  )
}
