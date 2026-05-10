import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getCathodeSummary, getCathodeGenres, getCathodeTimeline,
  type CathodeSummary, type CathodeGenre, type CathodeTimeline,
} from '../lib/api'
import { Cpu, ChevronDown, ChevronRight, Headphones, Speaker, Radio } from 'lucide-react'

function EndpointIcon({ type }: { type?: string }) {
  if (type === 'airplay' || type === 'airplay2') return <Radio className="w-4 h-4 text-blue-400" />
  if (type === 'headphone') return <Headphones className="w-4 h-4 text-violet-400" />
  return <Speaker className="w-4 h-4 text-zinc-400" />
}

function HoursBar({ hours, maxHours }: { hours: number; maxHours: number }) {
  const pct = maxHours > 0 ? Math.min(100, (hours / maxHours) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-zinc-400">{hours.toFixed(1)}h</span>
    </div>
  )
}

function GenreBar({ genre, hours, maxHours }: { genre: string; hours: number; maxHours: number }) {
  const pct = maxHours > 0 ? Math.min(100, (hours / maxHours) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-400 w-28 truncate flex-shrink-0">{genre}</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-zinc-500 w-10 text-right">{hours.toFixed(1)}h</span>
    </div>
  )
}

function TimelineBar({ data }: { data: CathodeTimeline[] }) {
  if (!data.length) return null
  const maxHours = Math.max(...data.map(d => d.hours), 0.1)
  return (
    <div className="flex items-end gap-0.5 h-16">
      {data.map(d => (
        <div key={d.month} className="flex flex-col items-center gap-0.5 flex-1 min-w-0" title={`${d.month}: ${d.hours.toFixed(1)}h`}>
          <div
            className="w-full rounded-t bg-violet-600/60 hover:bg-violet-500/80 transition-colors"
            style={{ height: `${Math.max(2, (d.hours / maxHours) * 56)}px` }}
          />
        </div>
      ))}
    </div>
  )
}

function EndpointRow({ ep, maxHours }: { ep: CathodeSummary; maxHours: number }) {
  const [open, setOpen] = useState(false)

  const { data: genres = [] } = useQuery<CathodeGenre[]>({
    queryKey: ['cathode-genres', ep.endpoint_id],
    queryFn: () => getCathodeGenres(ep.endpoint_id),
    enabled: open,
    staleTime: 60_000,
  })

  const { data: timeline = [] } = useQuery<CathodeTimeline[]>({
    queryKey: ['cathode-timeline', ep.endpoint_id],
    queryFn: () => getCathodeTimeline(ep.endpoint_id),
    enabled: open,
    staleTime: 60_000,
  })

  const maxGenreHours = genres.length ? Math.max(...genres.map(g => g.hours)) : 1

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full grid grid-cols-[auto_auto_1fr_auto_auto_auto] items-center gap-4 px-5 py-4 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <span className="text-zinc-500">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <EndpointIcon type={ep.endpoint_type} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">
            {ep.endpoint_name ?? ep.endpoint_id}
          </p>
          <p className="text-xs text-zinc-500">
            {ep.model ? `${ep.model} · ` : ''}{ep.play_count.toLocaleString()} plays
            {ep.top_genre ? ` · mostly ${ep.top_genre}` : ''}
          </p>
        </div>
        <HoursBar hours={ep.hours_played} maxHours={maxHours} />
        {ep.top_format && (
          <span className="font-mono text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded hidden md:inline">
            {ep.top_format}
          </span>
        )}
        <span className="text-xs text-zinc-600 hidden lg:block font-mono">
          {ep.first_use ? new Date(ep.first_use).getFullYear() : '—'}–{ep.last_use ? new Date(ep.last_use).getFullYear() : '—'}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
          {/* Genre breakdown */}
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">Genre breakdown</p>
            {genres.length === 0
              ? <p className="text-zinc-600 text-xs">No genre data</p>
              : <div className="flex flex-col gap-2">
                  {genres.map(g => (
                    <GenreBar key={g.genre} genre={g.genre} hours={g.hours} maxHours={maxGenreHours} />
                  ))}
                </div>
            }
          </div>

          {/* Monthly burn-in timeline */}
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">Monthly burn-in</p>
            {timeline.length === 0
              ? <p className="text-zinc-600 text-xs">No timeline data</p>
              : <>
                  <TimelineBar data={timeline} />
                  <div className="flex justify-between text-[9px] text-zinc-700 mt-1 font-mono">
                    <span>{timeline[0]?.month?.slice(0, 7)}</span>
                    <span>{timeline[timeline.length - 1]?.month?.slice(0, 7)}</span>
                  </div>
                </>
            }
          </div>
        </div>
      )}
    </div>
  )
}

export default function Cathode() {
  const { data: endpoints = [], isLoading } = useQuery<CathodeSummary[]>({
    queryKey: ['cathode-summary'],
    queryFn: getCathodeSummary,
    staleTime: 60_000,
  })

  const maxHours = endpoints.length ? Math.max(...endpoints.map(e => e.hours_played)) : 1

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Cathode</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Hardware analytics — burn-in hours, genre affinities, and monthly usage per endpoint.
        </p>
      </div>

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : endpoints.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Cpu className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm max-w-xs">
            No endpoint play history yet. Start playing tracks through named endpoints to populate burn-in stats.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {endpoints.map(ep => (
            <EndpointRow key={ep.endpoint_id} ep={ep} maxHours={maxHours} />
          ))}
        </div>
      )}
    </div>
  )
}
