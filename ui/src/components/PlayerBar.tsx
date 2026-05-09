import { useState } from 'react'
import { usePlayback } from '../lib/usePlayback'
import {
  CheckCircle, AlertTriangle, Radio, ChevronDown, ChevronUp,
  FileAudio, Cpu, Sliders, Wifi, Speaker,
} from 'lucide-react'
import clsx from 'clsx'

// ── Chain node ────────────────────────────────────────────────────────────────

type NodeColor = 'violet' | 'amber' | 'red' | 'zinc'

const NODE_STYLES: Record<NodeColor, string> = {
  violet: 'border-violet-700/60 bg-violet-950/40 text-violet-300',
  amber:  'border-amber-700/60  bg-amber-950/40  text-amber-300',
  red:    'border-red-700/60    bg-red-950/40    text-red-300',
  zinc:   'border-zinc-700/60   bg-zinc-900      text-zinc-400',
}

function ChainNode({
  icon: Icon,
  label,
  detail,
  color = 'zinc',
}: {
  icon: React.ElementType
  label: string
  detail: string
  color?: NodeColor
}) {
  return (
    <div className={clsx(
      'flex items-center gap-2 rounded-lg border px-3 py-1.5 min-w-0',
      NODE_STYLES[color],
    )}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-widest opacity-60 leading-none mb-0.5">{label}</p>
        <p className="text-[11px] font-mono leading-none truncate max-w-[160px]">{detail}</p>
      </div>
    </div>
  )
}

function Arrow() {
  return <span className="text-zinc-700 text-xs flex-shrink-0">→</span>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtKhz(sr: number) {
  return sr % 1000 === 0 ? `${sr / 1000}kHz` : `${(sr / 1000).toFixed(1)}kHz`
}

function sourceColor(is_bit_perfect: boolean, format: string): NodeColor {
  if (!is_bit_perfect) return 'amber'
  const lossy = /mp3|aac|ogg|opus|wma/i.test(format)
  return lossy ? 'amber' : 'violet'
}

function transportColor(transport: string, is_bit_perfect: boolean): NodeColor {
  if (!is_bit_perfect) return 'amber'
  if (/airplay/i.test(transport)) return 'amber'   // AirPlay = mandatory downsampling
  if (/alsa/i.test(transport)) return 'violet'
  return 'zinc'
}

// ── PlayerBar ─────────────────────────────────────────────────────────────────

export default function PlayerBar() {
  const signal = usePlayback()
  const [expanded, setExpanded] = useState(false)

  if (!signal || signal.state === 'stopped') {
    return (
      <div className="flex h-14 items-center border-t border-zinc-800 bg-[#18181b] px-6">
        <span className="text-xs text-zinc-600">No track playing</span>
      </div>
    )
  }

  const filename   = signal.path.split('/').pop() ?? signal.path
  const sourceFmt  = [
    signal.source_format,
    signal.source_bit_depth > 0 ? `${signal.source_bit_depth}-bit` : null,
    signal.source_sample_rate  ? fmtKhz(signal.source_sample_rate) : null,
  ].filter(Boolean).join(' · ')

  const isAirPlay  = /airplay/i.test(signal.transport)
  const outputFmt  = signal.output_format || (isAirPlay ? 'ALAC 16-bit 44.1kHz' : sourceFmt)

  return (
    <div className="flex-shrink-0 border-t border-zinc-800 bg-[#18181b]">
      {/* ── Compact row ──────────────────────────────────────────────────── */}
      <div className="flex h-14 items-center gap-4 px-6">
        <Radio
          className={clsx(
            'h-4 w-4 flex-shrink-0',
            signal.state === 'playing' ? 'text-violet-400 animate-pulse' : 'text-zinc-600',
          )}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{filename}</p>
          <p className="truncate text-xs text-zinc-500">{signal.output_endpoint}</p>
        </div>

        {/* Quality pill */}
        <div className="hidden items-center gap-2 sm:flex">
          {signal.hash_verified ? null : (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle className="h-3 w-3" /> Hash fail
            </span>
          )}
          {signal.is_bit_perfect ? (
            <span className="flex items-center gap-1 rounded-full bg-violet-900/40 border border-violet-700/40 px-2.5 py-0.5 text-[10px] font-semibold text-violet-300">
              <CheckCircle className="h-3 w-3" /> BIT-PERFECT
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-amber-900/30 border border-amber-700/40 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">
              <AlertTriangle className="h-3 w-3" /> PROCESSED
            </span>
          )}
          <span className="font-mono text-[10px] text-zinc-500">{sourceFmt}</span>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          title="Toggle signal chain"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Signal chain</span>
        </button>
      </div>

      {/* ── Expanded signal chain ─────────────────────────────────────────── */}
      {expanded && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/60 px-6 py-3">
          <ChainNode
            icon={FileAudio}
            label="Source"
            detail={sourceFmt || signal.source_format}
            color={sourceColor(signal.is_bit_perfect, signal.source_format)}
          />
          <Arrow />
          <ChainNode
            icon={Cpu}
            label="Decoder"
            detail={signal.decoder || 'Internal'}
            color="zinc"
          />
          {signal.dsp_active && (
            <>
              <Arrow />
              <ChainNode
                icon={Sliders}
                label="DSP / PEQ"
                detail="Parametric EQ active"
                color="amber"
              />
            </>
          )}
          <Arrow />
          <ChainNode
            icon={Wifi}
            label="Transport"
            detail={signal.transport}
            color={transportColor(signal.transport, signal.is_bit_perfect)}
          />
          <Arrow />
          <ChainNode
            icon={Speaker}
            label="Output"
            detail={outputFmt}
            color={isAirPlay ? 'amber' : signal.is_bit_perfect ? 'violet' : 'amber'}
          />

          {isAirPlay && (
            <p className="w-full text-[9px] text-amber-700/70 font-mono mt-0.5">
              AirPlay enforces 16-bit / 44.1kHz ALAC — original master preserved locally
            </p>
          )}
          {!signal.hash_verified && (
            <p className="w-full text-[9px] text-red-500/80 font-mono mt-0.5">
              ⚠ BLAKE3 hash mismatch — file may have been modified since ingestion
            </p>
          )}
        </div>
      )}
    </div>
  )
}
