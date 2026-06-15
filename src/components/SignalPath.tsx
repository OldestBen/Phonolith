'use client'

import { useEffect, useRef } from 'react'
import type { SignalPathState } from '@/lib/types'

// ── Individual node card ──────────────────────────────────────────────────────

interface NodeProps {
  stage: string
  detail: string
  sub?: string
  icon: React.ReactNode
  bitPerfect?: boolean
  active: boolean
  dim?: boolean
}

function PathNode({ stage, detail, sub, icon, bitPerfect, active, dim }: NodeProps) {
  const borderColor = !active
    ? 'border-border'
    : bitPerfect === false
    ? 'border-warning/60'
    : 'border-accent/60'
  const glowColor = !active
    ? ''
    : bitPerfect === false
    ? 'shadow-[0_0_12px_rgba(245,158,11,0.15)]'
    : 'shadow-[0_0_12px_rgba(167,139,250,0.2)]'

  return (
    <div
      className={`
        relative flex flex-col gap-1.5 px-4 py-3 rounded-xl border bg-surface
        min-w-[130px] transition-all duration-500
        ${borderColor} ${glowColor}
        ${dim ? 'opacity-30' : 'opacity-100'}
      `}
    >
      <div className={`flex items-center gap-2 ${active ? 'text-accent' : 'text-text-muted'}`}>
        <span className="w-4 h-4 shrink-0">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest">{stage}</span>
      </div>
      <span className={`text-xs font-mono font-medium leading-tight ${active ? 'text-text-primary' : 'text-text-muted'}`}>
        {detail}
      </span>
      {sub && (
        <span className="text-[10px] text-text-muted leading-tight truncate max-w-[160px]">{sub}</span>
      )}
      {active && bitPerfect !== undefined && (
        <span className={`text-[9px] uppercase tracking-wider font-bold ${bitPerfect ? 'text-success' : 'text-warning'}`}>
          {bitPerfect ? '● Bit-perfect' : '● Converted'}
        </span>
      )}
    </div>
  )
}

// ── Animated connector line ───────────────────────────────────────────────────

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex items-center px-1 shrink-0">
      <div className="relative w-10 h-px">
        <div className={`absolute inset-0 ${active ? 'bg-accent/30' : 'bg-border'}`} />
        {active && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent"
            style={{ animation: 'signal-flow 1.6s linear infinite' }}
          />
        )}
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
)

const CpuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <rect x="9" y="9" width="6" height="6" /><rect x="2" y="2" width="20" height="20" rx="2" />
    <line x1="9" y1="2" x2="9" y2="4" /><line x1="15" y1="2" x2="15" y2="4" />
    <line x1="9" y1="20" x2="9" y2="22" /><line x1="15" y1="20" x2="15" y2="22" />
    <line x1="2" y1="9" x2="4" y2="9" /><line x1="2" y1="15" x2="4" y2="15" />
    <line x1="20" y1="9" x2="22" y2="9" /><line x1="20" y1="15" x2="22" y2="15" />
  </svg>
)

const WaveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

const RadioIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 010 8.49m-8.48-.01a6 6 0 010-8.49m11.31-2.82a10 10 0 010 14.14m-14.14 0a10 10 0 010-14.14" />
  </svg>
)

const SpeakerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
  </svg>
)

// ── Format helpers ────────────────────────────────────────────────────────────

function formatHz(hz: number | null): string {
  if (!hz) return '—'
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`
  return `${hz} Hz`
}

function sourceDetail(sp: SignalPathState): string {
  const parts: string[] = []
  if (sp.source_bit_depth) parts.push(`${sp.source_bit_depth}bit`)
  if (sp.source_sample_rate) parts.push(formatHz(sp.source_sample_rate))
  if (sp.source_format) parts.push(sp.source_format.toUpperCase())
  return parts.length ? parts.join(' / ') : 'Unknown'
}

function basename(p: string | null): string {
  if (!p) return ''
  return p.split('/').pop() ?? p
}

// ── Main component ────────────────────────────────────────────────────────────

interface SignalPathProps {
  signalPath: SignalPathState
  className?: string
}

export default function SignalPath({ signalPath: sp, className = '' }: SignalPathProps) {
  const playing = sp.status === 'playing' || sp.status === 'paused'
  const active = sp.status === 'playing'

  const nodes = [
    {
      stage: 'Source',
      detail: playing ? sourceDetail(sp) : '—',
      sub: playing ? basename(sp.source_file) : 'No file loaded',
      icon: <FileIcon />,
      bitPerfect: true,
      active: playing,
    },
    {
      stage: 'Decoder',
      detail: sp.decoder ?? (playing ? 'Unknown' : '—'),
      icon: <CpuIcon />,
      bitPerfect: true,
      active: playing,
    },
    ...(sp.dsp_chain.length > 0
      ? [{
          stage: 'DSP',
          detail: sp.dsp_chain.join(', '),
          icon: <WaveIcon />,
          bitPerfect: false,
          active: playing,
        }]
      : []),
    {
      stage: 'Transport',
      detail: sp.transport,
      sub: sp.alsa_device !== 'default' ? sp.alsa_device : undefined,
      icon: <RadioIcon />,
      bitPerfect: sp.bit_perfect,
      active: playing,
    },
    {
      stage: 'Endpoint',
      detail: sp.endpoint_name ?? 'Default output',
      icon: <SpeakerIcon />,
      bitPerfect: sp.bit_perfect,
      active: playing,
    },
  ]

  return (
    <div className={`flex items-center gap-0 overflow-x-auto pb-1 ${className}`}>
      <style>{`
        @keyframes signal-flow {
          0%   { left: -8px; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { left: calc(100% + 8px); opacity: 0; }
        }
      `}</style>

      {nodes.map((node, i) => (
        <div key={node.stage} className="flex items-center">
          <PathNode
            stage={node.stage}
            detail={node.detail}
            sub={node.sub}
            icon={node.icon}
            bitPerfect={node.bitPerfect}
            active={node.active}
          />
          {i < nodes.length - 1 && <Connector active={active} />}
        </div>
      ))}
    </div>
  )
}
