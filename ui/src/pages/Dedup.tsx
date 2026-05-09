import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDedupCandidates, type DedupPair } from '../lib/api'
import { Copy, Layers, CheckCircle2, HardDrive } from 'lucide-react'
import clsx from 'clsx'

function fmt(bytes?: number) {
  if (!bytes) return '—'
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

function TrackBlock({ track, label, preferred }: {
  track: DedupPair['preferred']
  label: string
  preferred: boolean
}) {
  return (
    <div className={clsx(
      'flex-1 rounded-lg border p-3 flex flex-col gap-1',
      preferred ? 'border-green-800/50 bg-green-950/20' : 'border-zinc-800 bg-zinc-950',
    )}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {preferred && <CheckCircle2 className="w-3 h-3 text-green-400" />}
        <span className={clsx('text-[10px] font-medium uppercase tracking-widest',
          preferred ? 'text-green-500' : 'text-zinc-600'
        )}>
          {label}
        </span>
      </div>
      <p className="text-sm text-zinc-200 font-medium truncate">{track.title ?? '(unknown)'}</p>
      <p className="text-xs text-zinc-400 truncate">{track.artist ?? '—'}</p>
      <p className="text-xs text-zinc-500 truncate">{track.album ?? '—'}</p>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {track.format && (
          <span className="font-mono text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
            {track.format}{track.bit_depth ? ` ${track.bit_depth}b` : ''}
          </span>
        )}
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <HardDrive className="w-3 h-3" />{fmt(track.size_bytes)}
        </span>
      </div>
      <p className="font-mono text-[9px] text-zinc-700 truncate mt-0.5">{track.id}</p>
    </div>
  )
}

export default function Dedup() {
  const [floor, setFloor] = useState(0.998)

  const { data: pairs = [], isLoading, refetch } = useQuery<DedupPair[]>({
    queryKey: ['dedup', floor],
    queryFn: () => getDedupCandidates(floor),
    staleTime: 120_000,
    enabled: false,
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Acoustic Fingerprint Dedup</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-xl">
          Finds pairs of tracks that are acoustically identical (same audio content, different containers
          or metadata) using duration bucketing and cosine similarity on pre-computed embeddings.
          The larger file is flagged as the preferred copy.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-end gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4 w-fit">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-widest">
            Similarity floor (0.9–1.0)
          </label>
          <input
            type="number"
            min={0.9} max={1.0} step={0.001}
            value={floor}
            onChange={e => setFloor(parseFloat(e.target.value))}
            className="w-28 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 font-mono focus:outline-none focus:border-violet-500"
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <Copy className="w-4 h-4" />
          {isLoading ? 'Scanning…' : 'Scan library'}
        </button>
      </div>

      {/* Results */}
      {!isLoading && pairs.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Layers className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm">
            {pairs.length === 0
              ? 'Click "Scan library" to find acoustically identical tracks.'
              : 'No duplicate candidates found at this similarity threshold.'}
          </p>
        </div>
      )}

      {pairs.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-400">
            {pairs.length} duplicate pair{pairs.length !== 1 ? 's' : ''} found —
            {' '}delete the <span className="text-red-400">duplicate</span> copy and keep the
            {' '}<span className="text-green-400">preferred</span> (larger) file.
          </p>

          {pairs.map((p, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 font-mono">
                  similarity: <span className="text-violet-400">{(p.similarity * 100).toFixed(3)}%</span>
                </span>
              </div>
              <div className="flex gap-3 flex-col sm:flex-row">
                <TrackBlock track={p.preferred} label="Preferred — keep" preferred />
                <TrackBlock track={p.duplicate} label="Duplicate — safe to remove" preferred={false} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
