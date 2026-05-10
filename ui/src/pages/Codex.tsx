import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCodexStats, getCodexExportUrl, apiFetch, type CodexStats } from '../lib/api'
import {
  Download, BookOpen, Music, Users, Disc, Clock, BarChart2, Star,
  Upload, Ghost, Trash2, Search,
} from 'lucide-react'
import clsx from 'clsx'

type Tab = 'export' | 'ghost'

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value }: {
  icon: React.FC<{ className?: string }>; label: string; value: string | number
}) {
  return (
    <div className="flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-zinc-500 text-xs">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="text-2xl font-bold text-zinc-100 font-mono">{value}</p>
    </div>
  )
}

// ─── Export panel ─────────────────────────────────────────────────────────────

function ExportPanel() {
  const { data: stats, isLoading } = useQuery<CodexStats>({
    queryKey: ['codex-stats'],
    queryFn: getCodexStats,
    staleTime: 60_000,
  })

  return (
    <div className="flex flex-col gap-6">
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Music}    label="Tracks"       value={stats.track_count.toLocaleString()} />
          <StatCard icon={Users}    label="Artists"      value={stats.artist_count.toLocaleString()} />
          <StatCard icon={Disc}     label="Albums"       value={stats.album_count.toLocaleString()} />
          <StatCard icon={Clock}    label="Hours"        value={stats.total_hours.toLocaleString()} />
          <StatCard icon={BarChart2} label="DR analyzed" value={stats.dr_analyzed.toLocaleString()} />
          <StatCard icon={Star}     label="Rated tracks" value={stats.rated_count.toLocaleString()} />
          <StatCard icon={BookOpen} label="Scrobbles"    value={stats.play_event_count.toLocaleString()} />
        </div>
      ) : null}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 max-w-lg">
        <div className="flex items-start gap-3">
          <BookOpen className="w-8 h-8 text-violet-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">Export phonolith.codex</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Gzip-compressed SQLite containing tracks, albums, scrobble history, and all acoustic metadata.
              No audio data, no local paths.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-zinc-500">
          {[
            ['green', 'Portable — no absolute paths, only BLAKE3 hashes as identifiers'],
            ['green', 'Compact — typically a few MB even for 100k-track libraries'],
            ['green', 'Importable by peers as a "Ghost Library" for browsing your collection'],
            ['yellow', 'Contains ratings and play history — treat as semi-private'],
          ].map(([color, text], i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full bg-${color}-500 flex-shrink-0`} />
              {text}
            </div>
          ))}
        </div>

        <a
          href={getCodexExportUrl()}
          download="phonolith.codex"
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors w-fit"
        >
          <Download className="w-4 h-4" />
          Download .codex
        </a>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 max-w-lg">
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Codex schema v1.0</p>
        <div className="flex flex-col gap-2 text-xs font-mono">
          {[
            ['tracks',      '43 columns — all metadata, DR, ratings, acoustic data'],
            ['albums',      '13 columns — artwork dimensions, avg DR, Discogs value'],
            ['play_events', '7 columns — full scrobble history with format info'],
            ['codex_meta',  'created_at, track_count, schema_version'],
          ].map(([table, desc]) => (
            <div key={table} className="flex gap-3">
              <span className="text-violet-400 w-28 flex-shrink-0">{table}</span>
              <span className="text-zinc-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Ghost Library panel ──────────────────────────────────────────────────────

interface GhostLibrary {
  id: string
  name: string
  imported_at: string | null
  track_count: number
}

interface GhostTrack {
  title?: string
  artist?: string
  album?: string
  year?: number
  format?: string
  bit_depth?: number
  sample_rate?: number
  dr_score?: number
  duration_seconds?: number
}

function GhostPanel() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [activeLib, setActiveLib] = useState<GhostLibrary | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [importName, setImportName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState('')

  const { data: libraries = [], isLoading: libsLoading } = useQuery<GhostLibrary[]>({
    queryKey: ['ghost-libraries'],
    queryFn: () => apiFetch('/api/ghost/libraries'),
    staleTime: 30_000,
  })

  const { data: tracksData, isLoading: tracksLoading } = useQuery({
    queryKey: ['ghost-tracks', activeLib?.id, search, page],
    queryFn: () => apiFetch<{ tracks: GhostTrack[]; total: number }>(
      `/api/ghost/${activeLib!.id}/tracks?page=${page}&per_page=50${search ? `&search=${encodeURIComponent(search)}` : ''}`
    ),
    enabled: !!activeLib,
    staleTime: 60_000,
  })

  const { mutate: removeLib } = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ghost/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ghost-libraries'] })
      if (activeLib) setActiveLib(null)
    },
  })

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', importName || file.name.replace(/\.codex$/, ''))
      const res = await fetch('/api/ghost/import', { method: 'POST', body: fd })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t)
      }
      await qc.invalidateQueries({ queryKey: ['ghost-libraries'] })
      setImportName('')
    } catch (err) {
      setImportErr(String(err))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Import section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3 max-w-lg">
        <div className="flex items-center gap-2">
          <Ghost className="w-5 h-5 text-violet-400" />
          <p className="text-sm font-semibold text-zinc-100">Import Ghost Library</p>
        </div>
        <p className="text-xs text-zinc-500">
          Upload a <code className="font-mono text-violet-400">.codex</code> file shared by a peer.
          You can browse their metadata — no audio files needed.
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={importName}
            onChange={e => setImportName(e.target.value)}
            placeholder="Library name (optional)"
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
          />
          <label className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
            importing
              ? 'bg-zinc-700 text-zinc-500 pointer-events-none'
              : 'bg-violet-700 hover:bg-violet-600 text-white',
          )}>
            <Upload className="w-3.5 h-3.5" />
            {importing ? 'Importing…' : 'Choose .codex'}
            <input
              ref={fileRef}
              type="file"
              accept=".codex,.db,.sqlite"
              className="sr-only"
              onChange={handleImport}
            />
          </label>
        </div>
        {importErr && <p className="text-xs text-red-400">{importErr}</p>}
      </div>

      {/* Library list */}
      {libsLoading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : libraries.length === 0 ? (
        <p className="text-zinc-600 text-sm">No ghost libraries imported yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Imported libraries</p>
          {libraries.map(lib => (
            <div
              key={lib.id}
              className={clsx(
                'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors',
                activeLib?.id === lib.id
                  ? 'border-violet-700 bg-violet-950/30'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700',
              )}
              onClick={() => { setActiveLib(lib); setSearch(''); setPage(1) }}
            >
              <div>
                <p className="text-sm font-medium text-zinc-200">{lib.name}</p>
                <p className="text-xs text-zinc-500">
                  {lib.track_count.toLocaleString()} tracks
                  {lib.imported_at && ` · imported ${new Date(lib.imported_at).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); removeLib(lib.id) }}
                className="text-zinc-700 hover:text-red-400 transition-colors"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Track browser */}
      {activeLib && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-zinc-200">{activeLib.name}</p>
            <div className="flex items-center gap-2 flex-1 max-w-xs rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-zinc-600" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search tracks…"
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          {tracksLoading ? (
            <p className="text-zinc-500 text-sm">Loading…</p>
          ) : tracksData && tracksData.tracks.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
                      <th className="px-4 py-2 text-left font-medium">Title</th>
                      <th className="px-4 py-2 text-left font-medium">Artist</th>
                      <th className="px-4 py-2 text-left font-medium">Album</th>
                      <th className="px-4 py-2 text-left font-medium">Format</th>
                      <th className="px-4 py-2 text-right font-medium">DR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracksData.tracks.map((t, i) => (
                      <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                        <td className="px-4 py-2.5 text-zinc-200 font-medium text-xs truncate max-w-[180px]">
                          {t.title ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400 text-xs truncate max-w-[140px]">{t.artist ?? '—'}</td>
                        <td className="px-4 py-2.5 text-zinc-500 text-xs truncate max-w-[140px]">{t.album ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-zinc-500">
                          {[t.format, t.bit_depth ? `${t.bit_depth}b` : null].filter(Boolean).join(' ')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono text-zinc-400">
                          {t.dr_score != null ? `DR${t.dr_score}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>{tracksData.total.toLocaleString()} tracks</span>
                {tracksData.total > 50 && (
                  <>
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(p => p - 1)}
                      className="px-2 py-1 rounded bg-zinc-800 disabled:opacity-30 hover:bg-zinc-700 transition-colors"
                    >
                      ← Prev
                    </button>
                    <span>Page {page} of {Math.ceil(tracksData.total / 50)}</span>
                    <button
                      disabled={page >= Math.ceil(tracksData.total / 50)}
                      onClick={() => setPage(p => p + 1)}
                      className="px-2 py-1 rounded bg-zinc-800 disabled:opacity-30 hover:bg-zinc-700 transition-colors"
                    >
                      Next →
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="text-zinc-600 text-sm">No tracks found.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Codex() {
  const [tab, setTab] = useState<Tab>('export')

  const TABS = [
    { id: 'export' as Tab, label: 'Export', icon: BookOpen },
    { id: 'ghost'  as Tab, label: 'Ghost Libraries', icon: Ghost },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Sonic Codex</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Export your library intelligence or browse collections shared by peers as Ghost Libraries.
        </p>
      </div>

      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === id
                ? 'bg-violet-700 text-white'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'export' && <ExportPanel />}
      {tab === 'ghost'  && <GhostPanel />}
    </div>
  )
}
