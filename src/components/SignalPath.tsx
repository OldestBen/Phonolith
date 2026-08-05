'use client'

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
  rows?: [string, string][]
}

function PathNode({ stage, detail, sub, icon, bitPerfect, active, dim, rows }: NodeProps) {
  return (
    <div
      className="flex items-center gap-3.5 rounded-[7px] px-3.5 py-2.5 border shadow-[inset_0_1px_0_rgba(255,255,255,.08),inset_0_-18px_30px_rgba(0,0,0,.55)] transition-colors"
      style={{
        borderColor: active ? 'rgba(124,58,237,.5)' : '#27272a',
        background: active
          ? 'linear-gradient(180deg, rgba(76,29,149,.3), rgba(12,12,15,.95))'
          : 'linear-gradient(180deg, rgba(26,26,30,.95), rgba(12,12,15,.96))',
        boxShadow: active ? '0 0 26px rgba(109,40,217,.22)' : undefined,
        opacity: dim ? 0.4 : 1,
      }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          background: active ? '#4ade80' : '#3f3f46',
          boxShadow: active ? '0 0 9px #4ade80' : undefined,
        }}
      />
      <div className="w-[124px] shrink-0">
        <p className="m-0 flex items-center gap-1 text-[8.5px] uppercase tracking-[.24em]" style={{ color: active ? '#a78bfa' : '#52525b' }}>
          <span className="h-3 w-3 opacity-70">{icon}</span>
          {stage}
        </p>
        <p className="m-0 mt-0.5 text-[12.5px] font-semibold tracking-[.02em] text-text-primary truncate">{detail}</p>
        {sub && <p className="m-0 mt-0.5 text-[9.5px] text-text-faint truncate">{sub}</p>}
      </div>
      {rows && rows.length > 0 && (
        <div className="flex flex-1 min-w-0 gap-3.5 px-1">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <p className="m-0 text-[8.5px] uppercase tracking-[.14em] text-text-ghost whitespace-nowrap">{k}</p>
              <p className="m-0 mt-0.5 text-[11px] text-text-secondary whitespace-nowrap">{v}</p>
            </div>
          ))}
        </div>
      )}
      {bitPerfect !== undefined && (
        <span
          className="ml-auto shrink-0 text-[8.5px] tracking-[.1em] uppercase"
          style={{ color: active ? '#c4b5fd' : '#71717a' }}
        >
          {bitPerfect ? '✓ bit-perfect' : '⚠ converted'}
        </span>
      )}
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

  const nodes: NodeProps[] = [
    {
      stage: 'Source',
      detail: playing ? sourceDetail(sp) : '—',
      sub: playing ? basename(sp.source_file) : 'No file loaded',
      icon: <FileIcon />,
      bitPerfect: true,
      active: playing,
      rows: playing ? [['Format', sp.source_format ?? '—'], ['Channels', sp.source_channels === 2 ? 'Stereo' : sp.source_channels === 1 ? 'Mono' : `${sp.source_channels}ch`]] : undefined,
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

  // Stacked vertically, each card full-width — this is what actually gives
  // the per-stage key/value rows room to breathe. A horizontal row of 4-5
  // cards was tried first and didn't leave enough width per card once the
  // fixed-width name column and bit-perfect badge were accounted for.
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {nodes.map(node => (
        <PathNode key={node.stage} {...node} />
      ))}
    </div>
  )
}
