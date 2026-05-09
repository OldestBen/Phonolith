import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchSemantic, playTrack, type SemanticTrack } from '../lib/api'
import { Play, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'

const KEY_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function fmtBpm(bpm: number) {
  return bpm > 0 ? `${bpm.toFixed(0)} BPM` : '—'
}

function fmtDuration(secs?: number) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function EnergyBar({ value }: { value: number }) {
  // rms_energy typically 0.0–0.3; cap display at 0.3
  const pct = Math.min(100, (value / 0.3) * 100)
  return (
    <div className="h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full bg-violet-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function Search() {
  const [minBpm, setMinBpm] = useState('')
  const [maxBpm, setMaxBpm] = useState('')
  const [key, setKey]       = useState<string>('')
  const [playing, setPlaying] = useState<string | null>(null)

  const params = {
    min_bpm:    minBpm   ? Number(minBpm)   : undefined,
    max_bpm:    maxBpm   ? Number(maxBpm)   : undefined,
    key:        key !== '' ? Number(key)    : undefined,
    limit:      50,
  }

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['semantic', params],
    queryFn:  () => searchSemantic(params),
    enabled:  !!(params.min_bpm || params.max_bpm || params.key !== undefined),
    staleTime: 60_000,
  })

  async function handlePlay(hash: string) {
    setPlaying(hash)
    try { await playTrack(hash) } catch { /* surfaced via signal path */ }
  }

  const tracks: SemanticTrack[] = data ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Filter bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-zinc-300">Acoustic Search</h2>
          <span className="text-xs text-zinc-600 ml-2">
            Filter by BPM, key, or energy — powered by librosa embeddings
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Min BPM</label>
            <input
              type="number"
              min={40} max={240}
              value={minBpm}
              onChange={e => setMinBpm(e.target.value)}
              placeholder="e.g. 60"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Max BPM</label>
            <input
              type="number"
              min={40} max={240}
              value={maxBpm}
              onChange={e => setMaxBpm(e.target.value)}
              placeholder="e.g. 120"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Key</label>
            <select
              value={key}
              onChange={e => setKey(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
            >
              <option value="">Any</option>
              {KEY_NAMES.map((k, i) => (
                <option key={i} value={i}>{k}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { setMinBpm(''); setMaxBpm(''); setKey('') }}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {!params.min_bpm && !params.max_bpm && params.key === undefined ? (
        <p className="text-zinc-600 text-sm text-center py-8">
          Set at least one filter above to search by acoustic attributes.
        </p>
      ) : isLoading || isFetching ? (
        <p className="text-zinc-500 text-sm text-center py-8">Searching…</p>
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-8">
          Semantic index not ready — tracks are indexed after ingest.
        </p>
      ) : tracks.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-8">No tracks match those filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                <th className="w-10 px-2 py-3" />
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">BPM</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Energy</th>
                <th className="px-4 py-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map(t => (
                <tr
                  key={t.blake3_hash}
                  className="group border-b border-zinc-800/50 hover:bg-zinc-900 transition-colors"
                >
                  <td className="w-10 px-2 py-2.5 text-center">
                    <button
                      onClick={() => handlePlay(t.blake3_hash)}
                      className={clsx(
                        'rounded-full p-1 transition-colors',
                        playing === t.blake3_hash
                          ? 'text-violet-400'
                          : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-violet-400',
                      )}
                    >
                      <Play className="h-3.5 w-3.5" fill="currentColor" />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-200 truncate max-w-[300px]">
                    {t.path.split('/').pop()}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-zinc-300 text-xs">{fmtBpm(t.bpm)}</td>
                  <td className="px-4 py-2.5 font-mono text-violet-400 text-xs">
                    {KEY_NAMES[t.key_index] ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <EnergyBar value={t.rms_energy} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-zinc-400 text-xs">
                    {fmtDuration(t.duration_seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
