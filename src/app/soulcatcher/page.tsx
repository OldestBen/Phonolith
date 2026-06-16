'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface SoulseekResult {
  username: string
  filename: string
  size: number
  bitRate?: number
  length?: number
  sampleRate?: number
  bitDepth?: number
  extension?: string
}

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
}

interface SlskdStatus {
  online: boolean
  version?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function statusColor(status: SoulcatcherDownload['status']): string {
  switch (status) {
    case 'completed': return 'text-success'
    case 'failed': return 'text-danger'
    case 'downloading': return 'text-accent'
    default: return 'text-text-muted'
  }
}

// ── Result row ────────────────────────────────────────────────────────────────
function ResultRow({
  result,
  onDownload,
  downloading,
}: {
  result: SoulseekResult
  onDownload: () => void
  downloading: boolean
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-surface-2 transition-colors">
      <td className="py-2.5 pr-4 font-mono text-xs text-text-primary max-w-md truncate">
        {basename(result.filename)}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{result.username}</td>
      <td className="py-2.5 pr-4 text-text-muted">
        {result.bitRate ? `${result.bitRate} kbps` : '—'}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{formatSize(result.size)}</td>
      <td className="py-2.5">
        <button
          onClick={onDownload}
          disabled={downloading}
          className="px-3 py-1 rounded-lg bg-accent text-white text-xs font-medium
                     hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {downloading ? 'Queuing…' : 'Download'}
        </button>
      </td>
    </tr>
  )
}

// ── Download row ──────────────────────────────────────────────────────────────
function DownloadRow({ download, onIngest, ingesting }: {
  download: SoulcatcherDownload
  onIngest: () => void
  ingesting: boolean
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2.5 pr-4 font-mono text-xs text-text-primary max-w-md truncate">
        {basename(download.filename)}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{download.username}</td>
      <td className="py-2.5 pr-4 text-text-muted">{formatSize(download.size_bytes)}</td>
      <td className={`py-2.5 pr-4 font-medium ${statusColor(download.status)}`}>
        {download.status}
      </td>
      <td className="py-2.5">
        {download.status === 'completed' && !download.local_path && (
          <button
            onClick={onIngest}
            disabled={ingesting}
            className="px-3 py-1 rounded-lg bg-surface-2 border border-border text-text-primary text-xs font-medium
                       hover:bg-surface transition-colors disabled:opacity-50"
          >
            {ingesting ? 'Scanning…' : 'Add to Library'}
          </button>
        )}
        {download.local_path && (
          <span className="text-text-muted text-xs">In library</span>
        )}
      </td>
    </tr>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SoulcatcherPage() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SoulseekResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)

  const [downloads, setDownloads] = useState<SoulcatcherDownload[]>([])
  const [ingestingId, setIngestingId] = useState<number | null>(null)

  const [status, setStatus] = useState<SlskdStatus | null>(null)

  const fetchStatus = useCallback(() => {
    fetch('/api/soulcatcher/status')
      .then(r => r.ok ? r.json() : { online: false })
      .then(setStatus)
      .catch(() => setStatus({ online: false }))
  }, [])

  const fetchDownloads = useCallback(() => {
    fetch('/api/soulcatcher/downloads')
      .then(r => r.ok ? r.json() : { downloads: [] })
      .then(data => setDownloads(data.downloads ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchDownloads()
  }, [fetchStatus, fetchDownloads])

  // Poll downloads while anything is queued/downloading
  useEffect(() => {
    const active = downloads.some(d => d.status === 'queued' || d.status === 'downloading')
    if (!active) return
    const id = setInterval(fetchDownloads, 4000)
    return () => clearInterval(id)
  }, [downloads, fetchDownloads])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      const r = await fetch(`/api/soulcatcher/search?q=${encodeURIComponent(q)}`)
      if (!r.ok) throw new Error('Search failed')
      const data = await r.json()
      setResults(data.results ?? [])
      if ((data.results ?? []).length === 0) {
        setSearchError('No results — Soulseek may be offline or no peers have this file.')
      }
    } catch {
      setResults([])
      setSearchError('Search failed — check that the slskd sidecar is running.')
    } finally {
      setSearching(false)
    }
  }

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
      if (r.ok) {
        fetchDownloads()
      }
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-text-primary text-xl font-bold">Soulcatcher</h1>
        <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted text-xs flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status?.online ? 'bg-success' : 'bg-danger'}`} />
          {status?.online ? 'Soulseek connected' : 'Soulseek offline'}
        </span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search artist or track…"
          className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 flex-1
                     placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium
                     hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searchError && (
        <div className="mb-6 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-sm">
          {searchError}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="mb-10">
          <h2 className="text-text-primary font-semibold mb-3">Results ({results.length})</h2>
          <div className="overflow-x-auto bg-surface rounded-xl border border-border p-4">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-text-muted font-medium py-2 pr-4">File</th>
                  <th className="text-left text-text-muted font-medium py-2 pr-4">User</th>
                  <th className="text-left text-text-muted font-medium py-2 pr-4">Bitrate</th>
                  <th className="text-left text-text-muted font-medium py-2 pr-4">Size</th>
                  <th className="text-left text-text-muted font-medium py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map(result => {
                  const key = `${result.username}:${result.filename}`
                  return (
                    <ResultRow
                      key={key}
                      result={result}
                      onDownload={() => handleDownload(result)}
                      downloading={downloadingKey === key}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Downloads */}
      <div>
        <h2 className="text-text-primary font-semibold mb-3">Downloads</h2>
        {downloads.length === 0 ? (
          <p className="text-text-muted text-sm">No downloads yet — search above and queue a file.</p>
        ) : (
          <div className="overflow-x-auto bg-surface rounded-xl border border-border p-4">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-text-muted font-medium py-2 pr-4">File</th>
                  <th className="text-left text-text-muted font-medium py-2 pr-4">User</th>
                  <th className="text-left text-text-muted font-medium py-2 pr-4">Size</th>
                  <th className="text-left text-text-muted font-medium py-2 pr-4">Status</th>
                  <th className="text-left text-text-muted font-medium py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {downloads.map(d => (
                  <DownloadRow
                    key={d.id}
                    download={d}
                    onIngest={() => handleIngest(d)}
                    ingesting={ingestingId === d.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
