import { usePlayback } from '../lib/usePlayback'
import { CheckCircle, AlertTriangle, Radio } from 'lucide-react'
import clsx from 'clsx'

function Badge({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <span
      className={clsx(
        'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
        dim ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-700 text-zinc-300',
      )}
    >
      {children}
    </span>
  )
}

export default function PlayerBar() {
  const signal = usePlayback()

  if (!signal || signal.state === 'stopped') {
    return (
      <div className="flex h-14 items-center border-t border-zinc-800 bg-[#18181b] px-6">
        <span className="text-xs text-zinc-600">No track playing</span>
      </div>
    )
  }

  const filename = signal.path.split('/').pop() ?? signal.path
  const khz = signal.source_sample_rate
    ? `${(signal.source_sample_rate / 1000).toFixed(signal.source_sample_rate % 1000 === 0 ? 0 : 1)}kHz`
    : null

  return (
    <div className="flex h-16 flex-shrink-0 items-center gap-4 border-t border-zinc-800 bg-[#18181b] px-6">
      {/* Playing indicator */}
      <Radio
        className={clsx(
          'h-4 w-4 flex-shrink-0',
          signal.state === 'playing' ? 'text-violet-400 animate-pulse' : 'text-zinc-600',
        )}
      />

      {/* Track name */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{filename}</p>
        <p className="truncate text-xs text-zinc-500">{signal.output_endpoint}</p>
      </div>

      {/* Signal path badges */}
      <div className="hidden items-center gap-1.5 sm:flex">
        <Badge>{signal.source_format}</Badge>
        {signal.source_bit_depth > 0 && <Badge>{signal.source_bit_depth}‑bit</Badge>}
        {khz && <Badge>{khz}</Badge>}
        {signal.source_channels === 2 && <Badge dim>Stereo</Badge>}
        {signal.source_channels > 2 && <Badge>{signal.source_channels}ch</Badge>}
        {signal.source_bitrate_kbps > 0 && <Badge dim>{signal.source_bitrate_kbps}kbps</Badge>}
      </div>

      {/* Bit-perfect / hash badges */}
      <div className="hidden items-center gap-2 lg:flex">
        {signal.is_bit_perfect ? (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle className="h-3.5 w-3.5" /> Bit-perfect
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <AlertTriangle className="h-3.5 w-3.5" /> Lossy
          </span>
        )}
        {signal.hash_verified ? (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <CheckCircle className="h-3.5 w-3.5" /> BLAKE3 OK
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <AlertTriangle className="h-3.5 w-3.5" /> Hash fail
          </span>
        )}
      </div>

      {/* Transport */}
      <div className="hidden text-right xl:block">
        <p className="text-[10px] text-zinc-600">Transport</p>
        <p className="text-xs text-zinc-400">{signal.transport}</p>
      </div>
    </div>
  )
}
