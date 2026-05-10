import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPlaylistPreview, getPlaylistM3uUrl, playTrack, type PlaylistFilters, type PlaylistTrack } from '../lib/api'
import { Download, Play, ListMusic, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'

const KEY_OPTIONS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const FORMAT_OPTIONS = ['FLAC','WAV','AIFF','ALAC','MP3','AAC','DSF','DFF','OGG','WV']

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-zinc-500 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
const selectCls = "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"

function fmt(v: number | undefined, d = 1) {
  if (v == null) return '—'
  return v.toFixed(d)
}

export default function Playlists() {
  const [name, setName] = useState('My Playlist')
  const [playing, setPlaying] = useState<string | null>(null)
  const [filters, setFilters] = useState<PlaylistFilters>({})

  function set<K extends keyof PlaylistFilters>(key: K, raw: string) {
    setFilters(prev => {
      const next = { ...prev }
      if (raw === '' || raw === 'any') {
        delete next[key]
      } else if (key === 'lossless_only') {
        (next as any)[key] = raw === 'true'
      } else if (
        key === 'min_dr' || key === 'max_dr' || key === 'min_year' || key === 'max_year'
      ) {
        (next as any)[key] = parseInt(raw, 10)
      } else if (key === 'min_bpm' || key === 'max_bpm' || key === 'min_rating') {
        (next as any)[key] = parseFloat(raw)
      } else {
        (next as any)[key] = raw
      }
      return next
    })
  }

  // Debounced query key — only refetch when filters stabilise
  const { data: tracks = [], isLoading, isFetching } = useQuery({
    queryKey: ['playlist-preview', filters],
    queryFn: () => getPlaylistPreview(filters, 200),
    staleTime: 30_000,
  })

  async function handlePlay(e: React.MouseEvent, hash: string) {
    e.stopPropagation()
    setPlaying(hash)
    try { await playTrack(hash) } catch {}
  }

  const hasFilters = Object.keys(filters).length > 0

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Smart Playlist Builder</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Chain filters to sculpt a playlist. Preview updates live. Export as M3U for any player.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* Filter panel */}
        <div className="flex flex-col gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-zinc-300 text-sm font-medium mb-1">
            <SlidersHorizontal className="w-4 h-4" /> Filters
          </div>

          {/* Name */}
          <FilterField label="Playlist name">
            <input
              className={inputCls}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Playlist"
            />
          </FilterField>

          {/* DR range */}
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Min DR">
              <input type="number" min={0} max={30} className={inputCls} placeholder="—"
                onChange={e => set('min_dr', e.target.value)} />
            </FilterField>
            <FilterField label="Max DR">
              <input type="number" min={0} max={30} className={inputCls} placeholder="—"
                onChange={e => set('max_dr', e.target.value)} />
            </FilterField>
          </div>

          {/* BPM range */}
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Min BPM">
              <input type="number" min={30} max={300} className={inputCls} placeholder="—"
                onChange={e => set('min_bpm', e.target.value)} />
            </FilterField>
            <FilterField label="Max BPM">
              <input type="number" min={30} max={300} className={inputCls} placeholder="—"
                onChange={e => set('max_bpm', e.target.value)} />
            </FilterField>
          </div>

          {/* Year range */}
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="From year">
              <input type="number" min={1900} max={2100} className={inputCls} placeholder="—"
                onChange={e => set('min_year', e.target.value)} />
            </FilterField>
            <FilterField label="To year">
              <input type="number" min={1900} max={2100} className={inputCls} placeholder="—"
                onChange={e => set('max_year', e.target.value)} />
            </FilterField>
          </div>

          {/* Key */}
          <FilterField label="Key">
            <select className={selectCls} defaultValue="" onChange={e => set('key', e.target.value)}>
              <option value="">Any key</option>
              {KEY_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </FilterField>

          {/* Genre */}
          <FilterField label="Genre (partial match)">
            <input className={inputCls} placeholder="e.g. Jazz"
              onChange={e => set('genre', e.target.value)} />
          </FilterField>

          {/* Format */}
          <FilterField label="Format">
            <select className={selectCls} defaultValue="" onChange={e => set('format', e.target.value)}>
              <option value="">Any format</option>
              {FORMAT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </FilterField>

          {/* Engineer */}
          <FilterField label="Engineer / Mastered by">
            <input className={inputCls} placeholder="e.g. Bob Ludwig"
              onChange={e => set('engineer', e.target.value)} />
          </FilterField>

          {/* Min rating */}
          <FilterField label="Min rating (1–5 ★)">
            <select className={selectCls} defaultValue="" onChange={e => set('min_rating', e.target.value)}>
              <option value="">Any</option>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{'★'.repeat(n)} and above</option>)}
            </select>
          </FilterField>

          {/* Lossless only */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="rounded accent-violet-500"
              onChange={e => set('lossless_only', e.target.checked ? 'true' : '')}
            />
            <span className="text-sm text-zinc-300">Lossless only</span>
          </label>

          {/* Export button */}
          <a
            href={getPlaylistM3uUrl(filters, name || 'Phonolith Playlist')}
            download
            className={clsx(
              'mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tracks.length > 0
                ? 'bg-violet-700 hover:bg-violet-600 text-white'
                : 'bg-zinc-800 text-zinc-600 pointer-events-none',
            )}
          >
            <Download className="w-4 h-4" />
            Export M3U ({tracks.length} tracks)
          </a>
        </div>

        {/* Preview table */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-zinc-500" />
            <span className="text-sm text-zinc-400">
              {isLoading || isFetching
                ? 'Loading…'
                : hasFilters
                  ? `${tracks.length} tracks match`
                  : 'Set a filter to preview tracks'}
            </span>
          </div>

          {tracks.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2 text-left font-medium">Title</th>
                    <th className="px-3 py-2 text-left font-medium">Artist</th>
                    <th className="px-3 py-2 text-left font-medium">Album</th>
                    <th className="px-3 py-2 text-left font-medium">Year</th>
                    <th className="px-3 py-2 text-left font-medium">Format</th>
                    <th className="px-3 py-2 text-left font-medium">DR</th>
                    <th className="px-3 py-2 text-left font-medium">BPM</th>
                    <th className="px-3 py-2 text-left font-medium">Key</th>
                    <th className="px-3 py-2 text-left font-medium">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((t: PlaylistTrack) => (
                    <tr
                      key={t.hash}
                      className="group border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                    >
                      <td className="w-8 px-2 py-2 text-center">
                        <button
                          onClick={(e) => handlePlay(e, t.hash)}
                          className={clsx(
                            'rounded-full p-0.5 transition-colors',
                            playing === t.hash
                              ? 'text-violet-400'
                              : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-violet-400',
                          )}
                        >
                          <Play className="w-3 h-3" fill="currentColor" />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-zinc-200 truncate max-w-[160px]">{t.title ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-400 truncate max-w-[130px]">{t.artist ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-500 truncate max-w-[130px]">{t.album ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-500 text-xs">{t.year ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[10px] text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded">
                          {t.format ?? '?'}
                          {t.bit_depth ? ` ${t.bit_depth}b` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {t.dr_score != null ? (
                          <span className={clsx('font-mono text-xs font-bold',
                            t.dr_score >= 14 ? 'text-green-400' : t.dr_score >= 8 ? 'text-yellow-400' : 'text-red-400'
                          )}>DR{t.dr_score}</span>
                        ) : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 font-mono text-xs">
                        {t.bpm != null ? fmt(t.bpm, 0) : '—'}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 font-mono text-xs">{t.key ?? '—'}</td>
                      <td className="px-3 py-2 text-yellow-400 text-xs">
                        {t.internal_rating ? '★'.repeat(Math.round(t.internal_rating)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !isFetching && hasFilters && tracks.length === 0 && (
            <div className="flex items-center justify-center py-16 text-zinc-600 text-sm">
              No tracks match the current filters.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
