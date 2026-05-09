import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTracks, type Track } from '../lib/api'
import { Search, AlertTriangle, CheckCircle, Minus } from 'lucide-react'
import clsx from 'clsx'

function DrBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-zinc-600">—</span>
  const color = score >= 14 ? 'text-green-400' : score >= 8 ? 'text-yellow-400' : 'text-red-400'
  return <span className={clsx('font-mono font-bold', color)}>DR{score}</span>
}

function PrismBadge({ status }: { status: string | null }) {
  if (!status || status === 'pending') return <Minus className="w-4 h-4 text-zinc-600" />
  if (status === 'clean') return <CheckCircle className="w-4 h-4 text-green-500" />
  return <AlertTriangle className={clsx('w-4 h-4', status === 'fraud' ? 'text-red-500' : 'text-yellow-500')} />
}

function fmt(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Library() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['tracks', search, page],
    queryFn: () => getTracks({ search: search || undefined, page, per_page: 50 }),
    placeholderData: prev => prev,
  })

  const tracks = data?.tracks ?? []
  const total = data?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
            placeholder="Search tracks, artists, albums…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <span className="text-sm text-zinc-500">{total.toLocaleString()} tracks</span>
      </div>

      {isLoading ? (
        <div className="text-zinc-500 text-sm py-8 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Artist</th>
                <th className="px-4 py-3 font-medium">Album</th>
                <th className="px-4 py-3 font-medium">Format</th>
                <th className="px-4 py-3 font-medium">DR</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium text-center">Prism</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t: Track) => (
                <tr
                  key={t.id}
                  onClick={() => setSelected(t.id === selected ? null : t.id)}
                  className={clsx(
                    'border-b border-zinc-800/50 cursor-pointer transition-colors',
                    t.id === selected ? 'bg-violet-900/20' : 'hover:bg-zinc-900'
                  )}
                >
                  <td className="px-4 py-2.5 text-zinc-100 truncate max-w-[200px]">{t.title ?? t.filename}</td>
                  <td className="px-4 py-2.5 text-zinc-300 truncate max-w-[160px]">{t.artist ?? '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-400 truncate max-w-[160px]">{t.album ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
                      {t.format ?? '?'}
                      {t.bit_depth ? ` ${t.bit_depth}b` : ''}
                      {t.sample_rate ? `/${Math.round(t.sample_rate / 1000)}k` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><DrBadge score={t.dr_score} /></td>
                  <td className="px-4 py-2.5 font-mono text-zinc-400 text-xs">{fmt(t.duration_seconds)}</td>
                  <td className="px-4 py-2.5 text-center"><PrismBadge status={t.prism_status} /></td>
                </tr>
              ))}
              {tracks.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-600">No tracks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center gap-2 justify-end text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 disabled:opacity-40 hover:bg-zinc-700"
          >Prev</button>
          <span className="text-zinc-500">Page {page} of {Math.ceil(total / 50)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 disabled:opacity-40 hover:bg-zinc-700"
          >Next</button>
        </div>
      )}
    </div>
  )
}
