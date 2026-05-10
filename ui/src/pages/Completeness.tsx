import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

interface MissingAlbum {
  title: string
  year?: string | null
}

interface ArtistCompleteness {
  artist: string
  mb_artist_id: string
  total_albums: number
  owned_albums: number
  missing: MissingAlbum[]
  completeness_pct: number
}

function pctColor(pct: number) {
  if (pct >= 90) return 'bg-green-500'
  if (pct >= 60) return 'bg-yellow-500'
  if (pct >= 30) return 'bg-orange-500'
  return 'bg-red-500'
}

function ArtistRow({ row }: { row: ArtistCompleteness }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
              : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />}
            <span className="text-zinc-200 font-medium text-sm">{row.artist}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-zinc-800 min-w-[80px] max-w-[160px]">
              <div
                className={`h-full rounded-full transition-all ${pctColor(row.completeness_pct)}`}
                style={{ width: `${row.completeness_pct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-zinc-400 w-8 text-right">
              {row.completeness_pct}%
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-right text-xs font-mono text-zinc-400">
          {row.owned_albums} / {row.total_albums}
        </td>
        <td className="px-4 py-3 text-center">
          {row.completeness_pct === 100
            ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
            : <AlertCircle className="w-4 h-4 text-zinc-600 mx-auto" />}
        </td>
      </tr>
      {expanded && row.missing.length > 0 && (
        <tr className="border-b border-zinc-800/30 bg-zinc-900/50">
          <td colSpan={4} className="px-8 py-3">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Missing albums</p>
            <div className="flex flex-wrap gap-2">
              {row.missing.map((m, i) => (
                <span
                  key={i}
                  className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 px-2 py-1 rounded-md"
                >
                  {m.title}{m.year ? ` (${m.year})` : ''}
                </span>
              ))}
              {row.total_albums - row.owned_albums > row.missing.length && (
                <span className="text-xs text-zinc-600 italic px-2 py-1">
                  +{row.total_albums - row.owned_albums - row.missing.length} more…
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function Completeness() {
  const [limit, setLimit] = useState(50)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['completeness', limit],
    queryFn: () => apiFetch<ArtistCompleteness[]>(`/api/completeness?limit=${limit}`),
    staleTime: 300_000,
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Completeness Matrix</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Cross-references your library against MusicBrainz to show which official studio albums
          you own and which you're missing. Only artists with a MusicBrainz ID appear here.
          Results are cached for 24 hours.
        </p>
      </div>

      {(isLoading || isFetching) && !data && (
        <p className="text-zinc-500 text-sm py-8 text-center">
          Querying MusicBrainz for {limit} artists — this may take a moment…
        </p>
      )}

      {data && data.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm max-w-xs">
            No tracks with a MusicBrainz artist ID found. Run Lexicon to enrich your library metadata first.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <>
          {isFetching && (
            <p className="text-xs text-zinc-600">Refreshing…</p>
          )}
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
                  <th className="px-4 py-2 text-left font-medium">Artist</th>
                  <th className="px-4 py-2 text-left font-medium">Completeness</th>
                  <th className="px-4 py-2 text-right font-medium">Owned / Total</th>
                  <th className="px-4 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map(row => (
                  <ArtistRow key={row.mb_artist_id} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">Showing top</span>
            {[25, 50, 100, 200].map(n => (
              <button
                key={n}
                onClick={() => setLimit(n)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  limit === n
                    ? 'bg-violet-700 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-xs text-zinc-500">artists by completion (lowest first)</span>
          </div>
        </>
      )}
    </div>
  )
}
