'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LibraryFile, AlbumSummary } from '@/lib/types'
import AlbumTile from '@/components/AlbumTile'

// ── Helpers ───────────────────────────────────────────────────────────────────
function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function formatFormat(file: LibraryFile): string {
  const parts = [file.format?.toUpperCase()]
  if (file.bit_depth && file.sample_rate) {
    parts.push(`${file.bit_depth}/${Math.round(file.sample_rate / 1000)}`)
  }
  return parts.filter(Boolean).join(' ')
}

function DrScore({ score }: { score?: number }) {
  if (score == null) return <span className="text-text-muted">—</span>
  const cls =
    score > 12
      ? 'text-success'
      : score >= 8
      ? 'text-warning'
      : 'text-danger'
  return <span className={cls}>{score}</span>
}

// ── Library status ────────────────────────────────────────────────────────────
interface LibraryStatus {
  file_count?: number
  last_scan?: string
  watcher_status?: string
  library_path?: string
  scanning?: boolean
}

// ── Filter types ──────────────────────────────────────────────────────────────
type DRFilter = 'all' | 'high' | 'mid' | 'low'
type MatchFilter = 'all' | 'matched' | 'unmatched'
type ViewMode = 'albums' | 'files'

function LibraryPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const albumParam = searchParams.get('album')
  const artistParam = searchParams.get('artist')

  const [view, setView] = useState<ViewMode>(albumParam ? 'files' : 'albums')
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [albums, setAlbums] = useState<AlbumSummary[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(true)
  const [albumQuery, setAlbumQuery] = useState('')
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [activeScan, setActiveScan] = useState(false)
  const [deepScanning, setDeepScanning] = useState(false)

  // Filters
  const [formatFilter, setFormatFilter] = useState<string>('all')
  const [drFilter, setDrFilter] = useState<DRFilter>('all')
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all')
  const [search, setSearch] = useState(albumParam ?? '')

  // Initial load
  useEffect(() => {
    Promise.all([
      fetch('/api/library').then(r => r.ok ? r.json() : { files: [] }),
      fetch('/api/library/status').then(r => r.ok ? r.json() : null),
    ])
      .then(([libData, statusData]) => {
        setFiles(libData.files ?? libData ?? [])
        setStatus(statusData)
        if (statusData?.scanning) setActiveScan(true)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Poll while a scan is active — show files as they arrive, like Plex/Roon
  useEffect(() => {
    if (!activeScan) return
    const id = setInterval(async () => {
      try {
        const [libData, statusData] = await Promise.all([
          fetch('/api/library').then(r => r.ok ? r.json() : null),
          fetch('/api/library/status').then(r => r.ok ? r.json() : null),
        ])
        if (libData) setFiles(libData.files ?? libData ?? [])
        if (statusData) {
          setStatus(statusData)
          if (!statusData.scanning) setActiveScan(false)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(id)
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

  // Derive unique formats for filter dropdown
  const formats = ['all', ...Array.from(new Set(files.map(f => f.format).filter(Boolean) as string[]))]

  // Apply filters
  const filtered = files.filter(f => {
    if (formatFilter !== 'all' && f.format !== formatFilter) return false
    if (drFilter === 'high' && (f.dr_score == null || f.dr_score <= 12)) return false
    if (drFilter === 'mid' && (f.dr_score == null || f.dr_score < 8 || f.dr_score > 12)) return false
    if (drFilter === 'low' && (f.dr_score == null || f.dr_score >= 8)) return false
    if (matchFilter === 'matched' && !f.song_id) return false
    if (matchFilter === 'unmatched' && f.song_id) return false
    if (albumParam && f.album !== albumParam) return false
    if (artistParam && f.artist !== artistParam) return false
    if (search.trim() && !albumParam) {
      const needle = search.trim().toLowerCase()
      const haystack = `${basename(f.file_path)} ${f.album ?? ''} ${f.artist ?? ''} ${f.title ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })

  return (
    <div className="min-h-screen px-4 py-8 pb-20 md:pb-8">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-text-primary text-xl font-bold">Library</h1>
          <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted text-xs flex items-center gap-1.5">
            {activeScan && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
            {files.length} file{files.length !== 1 ? 's' : ''}
            {activeScan && ' — scanning…'}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {status?.last_scan && (
            <span className="text-text-muted text-xs">
              Last scan: {new Date(status.last_scan).toLocaleString()}
            </span>
          )}
          {(() => {
            const unscanned = files.filter(f => f.dr_score == null).length
            return unscanned > 0 ? (
              <button
                onClick={handleDeepScan}
                disabled={deepScanning || activeScan}
                title={`${unscanned} fast-indexed file${unscanned !== 1 ? 's' : ''} with no DR score`}
                className="px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs font-medium
                           hover:bg-warning/20 transition-colors disabled:opacity-50"
              >
                {deepScanning ? 'Analysing…' : `Analyse Unscanned (${unscanned})`}
              </button>
            ) : null
          })()}
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
          value={view === 'albums' ? albumQuery : search}
          onChange={e => view === 'albums' ? setAlbumQuery(e.target.value) : setSearch(e.target.value)}
          placeholder={view === 'albums' ? 'Search albums or artists…' : 'Search files…'}
          className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-1.5 flex-1 min-w-[200px] max-w-sm
                     placeholder:text-text-muted focus:outline-none focus:border-accent"
        />

        {(albumParam || artistParam) && view === 'files' && (
          <button
            onClick={() => router.push('/library')}
            className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-text-muted text-xs hover:text-text-primary transition-colors"
          >
            Clear album filter ×
          </button>
        )}
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
              <AlbumTile key={`${a.artist}::${a.album}`} {...a} />
            ))}
          </div>
        )
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
          {loading ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface-2 rounded" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-text-muted text-base mb-2">
                {files.length === 0
                  ? 'No files indexed. Mount a music directory and click Scan Library.'
                  : 'No files match the current filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-text-muted font-medium py-2 pr-4">File</th>
                    <th className="text-left text-text-muted font-medium py-2 pr-4">Format</th>
                    <th className="text-left text-text-muted font-medium py-2 pr-4">DR</th>
                    <th className="text-left text-text-muted font-medium py-2 pr-4">Quality</th>
                    <th className="text-left text-text-muted font-medium py-2 pr-4">Matched Song</th>
                    <th className="text-left text-text-muted font-medium py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(file => (
                    <tr
                      key={file.blake3_hash}
                      onClick={() => router.push(`/library/${file.blake3_hash}`)}
                      className="border-b border-border/50 hover:bg-surface-2 cursor-pointer transition-colors"
                    >
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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
