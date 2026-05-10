import { useQuery } from '@tanstack/react-query'
import { getTrack, getSnapshots, getWaveform, playTrack } from '../lib/api'
import WaveformViewer from './WaveformViewer'
import { Play, RotateCcw } from 'lucide-react'

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null
  return (
    <div className="flex gap-2 min-w-0">
      <span className="text-zinc-600 text-xs w-28 flex-shrink-0">{label}</span>
      <span className="text-zinc-300 text-xs truncate">{String(value)}</span>
    </div>
  )
}

interface Props {
  hash: string
  colSpan: number
}

export default function TrackDetail({ hash, colSpan }: Props) {
  const { data: track } = useQuery({
    queryKey: ['track', hash],
    queryFn: () => getTrack(hash),
    staleTime: 30_000,
  })

  const { data: snaps } = useQuery({
    queryKey: ['snapshots', hash],
    queryFn: () => getSnapshots(hash),
    staleTime: 30_000,
  })

  const { data: waveform } = useQuery({
    queryKey: ['waveform', hash],
    queryFn: () => getWaveform(hash),
    retry: false,
    staleTime: Infinity,
  })

  return (
    <tr>
      <td colSpan={colSpan} className="px-0 pb-0 pt-0">
        <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-5">
          {/* Waveform */}
          <div className="mb-4 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
            {waveform ? (
              <WaveformViewer hash={hash} height={72} />
            ) : (
              <div className="h-16 flex items-center justify-center">
                <span className="text-[10px] text-zinc-700 font-mono">
                  waveform renders after first analysis pass
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Core metadata */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Track Info</p>
              <Row label="Title"       value={track?.title} />
              <Row label="Artist"      value={track?.artist} />
              <Row label="Album"       value={track?.album} />
              <Row label="Year"        value={track?.year} />
              <Row label="Label"       value={track?.label} />
              <Row label="Genre"       value={track?.genre} />
              <Row label="Composer"    value={(track as any)?.composer} />
              <Row label="Lyricist"    value={(track as any)?.lyricist} />
              <Row label="Engineer"    value={(track as any)?.engineer} />
              <Row label="Mastered by" value={(track as any)?.mastered_by} />
              <Row label="Mixer"       value={(track as any)?.mixer} />
            </div>

            {/* Sonic metadata */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Audio</p>
              <Row label="Format"      value={track?.format?.toUpperCase()} />
              <Row label="Bit depth"   value={track?.bit_depth ? `${track.bit_depth}-bit` : null} />
              <Row label="Sample rate" value={track?.sample_rate ? `${(track.sample_rate / 1000).toFixed(track.sample_rate % 1000 === 0 ? 0 : 1)} kHz` : null} />
              <Row label="DR score"    value={(track as any)?.dr_score ? `DR${(track as any).dr_score}` : null} />
              <Row label="Peak"        value={(track as any)?.peak_level != null ? `${Number((track as any).peak_level).toFixed(2)} dBFS` : null} />
              <Row label="RMS"         value={(track as any)?.rms_level != null ? `${Number((track as any).rms_level).toFixed(2)} dBFS` : null} />
              <Row label="BPM (tag)"   value={(track as any)?.bpm ? `${Number((track as any).bpm).toFixed(1)}` : null} />
              <Row label="BPM (audio)" value={(track as any)?.detected_bpm ? `${Number((track as any).detected_bpm).toFixed(1)}` : null} />
              <Row label="Key (tag)"   value={(track as any)?.initial_key} />
              <Row label="Key (audio)" value={(track as any)?.detected_key} />
              <Row label="Prism"       value={(track as any)?.prism_status} />
              <Row label="AccurateRip" value={(track as any)?.accuraterip_result} />
            </div>

            {/* Actions + Engram snapshots */}
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Actions</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => playTrack(hash)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-xs font-medium transition-colors"
                  >
                    <Play className="w-3 h-3" fill="currentColor" /> Play (ALSA)
                  </button>
                </div>
              </div>

              {/* Engram restore points */}
              {snaps && snaps.length > 0 && (
                <div>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">
                    Tag History ({snaps.length})
                  </p>
                  <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {snaps.map(s => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2"
                      >
                        <RotateCcw className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-zinc-400 truncate">
                            {s.snapshot_type}
                          </p>
                          <p className="text-[10px] text-zinc-600">
                            {new Date(s.captured_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BLAKE3 hash */}
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Identity</p>
                <p className="font-mono text-[10px] text-zinc-700 break-all">{hash}</p>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}
