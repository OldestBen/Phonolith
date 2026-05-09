import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMasteringEngineers, getEngineerTracks, playTrack, type MasteringEngineer, type Track } from '../lib/api'
import { ChevronDown, ChevronRight, Play, Mic2 } from 'lucide-react'
import clsx from 'clsx'

function DrBar({ value, max }: { value: number | null; max: number }) {
  if (value == null) return <span className="text-zinc-600 text-xs">—</span>
  const pct = Math.min(100, (value / max) * 100)
  const color = value >= 14 ? 'bg-green-500' : value >= 8 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={clsx('font-mono text-xs font-bold',
        value >= 14 ? 'text-green-400' : value >= 8 ? 'text-yellow-400' : 'text-red-400'
      )}>
        DR{value}
      </span>
    </div>
  )
}

function RatingDots({ value }: { value: number | null }) {
  if (!value) return <span className="text-zinc-600 text-xs">—</span>
  const stars = Math.round(value)
  return (
    <span className="text-yellow-400 text-xs tracking-tight">
      {'★'.repeat(stars)}{'☆'.repeat(Math.max(0, 5 - stars))}
    </span>
  )
}

function EngineerRow({ eng, maxDr }: { eng: MasteringEngineer; maxDr: number }) {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)

  const { data: tracks, isLoading } = useQuery({
    queryKey: ['engineer-tracks', eng.credit],
    queryFn: () => getEngineerTracks(eng.credit),
    enabled: open,
    staleTime: 60_000,
  })

  async function handlePlay(e: React.MouseEvent, hash: string) {
    e.stopPropagation()
    setPlaying(hash)
    try { await playTrack(hash) } catch {}
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Engineer summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-4 px-5 py-4 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <span className="text-zinc-500">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{eng.credit}</p>
          <p className="text-xs text-zinc-500">{eng.track_count} tracks · {eng.library_pct}% of library</p>
        </div>
        <DrBar value={eng.avg_dr} max={maxDr} />
        <RatingDots value={eng.avg_rating} />
        <span className="text-xs text-zinc-500 hidden md:block">
          {eng.lossless_count}/{eng.track_count} lossless
        </span>
        <span className="text-xs font-mono text-zinc-600 hidden lg:block">
          {eng.avg_peak != null ? `${eng.avg_peak}dBFS` : '—'}
        </span>
        <span className="text-xs font-mono text-zinc-600 hidden lg:block">
          RMS {eng.avg_rms != null ? eng.avg_rms : '—'}
        </span>
      </button>

      {/* Track list */}
      {open && (
        <div className="border-t border-zinc-800">
          {isLoading ? (
            <p className="text-zinc-500 text-sm p-4">Loading…</p>
          ) : (
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
                  <th className="px-3 py-2 text-left font-medium">Rating</th>
                </tr>
              </thead>
              <tbody>
                {(tracks ?? []).map((t: Track) => (
                  <tr
                    key={t.hash}
                    className="group border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors"
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
                    <td className="px-3 py-2 text-zinc-200 truncate max-w-[180px]">{t.title ?? t.filename}</td>
                    <td className="px-3 py-2 text-zinc-400 truncate max-w-[140px]">{t.artist ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-500 truncate max-w-[140px]">{t.album ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-500 text-xs">{(t as any).year ?? '—'}</td>
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
                        )}>
                          DR{t.dr_score}
                        </span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-yellow-400 text-xs">
                      {t.internal_rating ? '★'.repeat(Math.round(t.internal_rating)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function Engineers() {
  const { data: engineers, isLoading } = useQuery({
    queryKey: ['mastering-engineers'],
    queryFn: getMasteringEngineers,
  })

  const maxDr = engineers
    ? Math.max(...engineers.map(e => e.avg_dr ?? 0), 20)
    : 20

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Mastering Engineer Matrix</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Engineers and masterers ranked by average Dynamic Range score across your library.
          Expand to see every track they touched.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-zinc-600">
        <span className="flex items-center gap-1"><span className="text-green-400">■</span> DR ≥ 14 (excellent)</span>
        <span className="flex items-center gap-1"><span className="text-yellow-400">■</span> DR ≥ 8 (good)</span>
        <span className="flex items-center gap-1"><span className="text-red-400">■</span> DR &lt; 8 (compressed)</span>
      </div>

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : !engineers?.length ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Mic2 className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm">
            No engineer credits found yet — they populate from MASTERED_BY and ENGINEER tags during ingest.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {engineers.map(e => (
            <EngineerRow key={e.credit} eng={e} maxDr={maxDr} />
          ))}
        </div>
      )}
    </div>
  )
}
