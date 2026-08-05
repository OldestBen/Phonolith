'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { LucidStatus, SignalPathState } from '@/lib/types'
import SignalPath from './SignalPath'
import WaveformScrubber from './WaveformScrubber'
import EndpointPickerModal from './EndpointPickerModal'
import { useBrowserPlayer } from '@/contexts/BrowserPlayerContext'
import { useSelectedEndpoint, endpointLabel } from '@/lib/endpoint'
import type { StreamQuality } from '@/hooks/useGaplessPlayer'

const QUALITY_OPTIONS: { value: StreamQuality; label: string }[] = [
  { value: 'lossless', label: 'Lossless' },
  { value: 'opus-128', label: 'Opus 128k' },
  { value: 'opus-96', label: 'Opus 96k' },
  { value: 'opus-64', label: 'Opus 64k' },
  { value: 'opus-32', label: 'Opus 32k (cellular)' },
]

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function basename(p: string | null): string {
  if (!p) return ''
  return p.split('/').pop()?.replace(/\.[^.]+$/, '') ?? p
}

let lastNowPlayingTitle: string | null = null

/** Feeds the Polyphony "now playing" beacon so trusted peers can see what's playing here. */
function postNowPlaying(title: string | null, artist: string | null) {
  if (title === lastNowPlayingTitle) return
  lastNowPlayingTitle = title
  fetch('/api/polyphony/now-playing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, artist }),
  }).catch(() => {})
}

// ── Playback control icons — small and flat, matching the instrument-panel
//    aesthetic. The mockup itself never modelled interactive transport (it's
//    a static "now playing" strip reflecting whatever Lucid/AirPlay is doing
//    externally), but real playback control is genuine functionality the
//    real app needs, so it's kept — restyled to fit rather than dropped. ──

const PrevIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
  </svg>
)

const NextIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm2.5-6l5.5 4V8l-5.5 4zM16 6h2v12h-2z" />
  </svg>
)

const PlayIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const PauseIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
)

const StopIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h12v12H6z" />
  </svg>
)

const SpeakerIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
)

// ── Small shared bits ─────────────────────────────────────────────────────

/** The mockup's flat outlined text button (used for "Signal path", endpoint, quality). */
function DockButton({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-[10px] transition-colors ${
        active ? 'border-accent-dim/60 text-accent-bright' : 'border-[#3f3f46] text-text-secondary hover:border-accent-dim hover:bg-accent-dim/[.14]'
      }`}
      style={{ background: '#131316' }}
    >
      {children}
    </button>
  )
}

function TimeBadge({ value, dim }: { value: string; dim?: boolean }) {
  return (
    <span
      className="shrink-0 rounded-[3px] border border-border px-1.5 py-0.5 text-[11px] font-bold tracking-[.12em]"
      style={{
        background: '#0a0a0c',
        color: dim ? '#8a6a35' : '#ffb340',
        textShadow: dim ? undefined : '0 0 8px rgba(255,179,64,.55)',
        boxShadow: 'inset 0 0 10px rgba(0,0,0,.8)',
      }}
    >
      {value}
    </span>
  )
}

function BitPerfectPill({ bitPerfect }: { bitPerfect: boolean }) {
  return bitPerfect ? (
    <span
      className="hidden md:flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9.5px] font-semibold tracking-[.06em]"
      style={{
        borderColor: 'rgba(124,58,237,.45)',
        background: 'rgba(109,40,217,.3)',
        color: '#c4b5fd',
        boxShadow: '0 0 14px rgba(109,40,217,.35)',
      }}
    >
      ✓ BIT-PERFECT
    </span>
  ) : (
    <span className="hidden md:flex shrink-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[9.5px] font-semibold tracking-[.06em] text-warning">
      ⚠ CONVERTED
    </span>
  )
}

// ── Main bar ──────────────────────────────────────────────────────────────────

export default function PlaybackBar() {
  const [status, setStatus] = useState<LucidStatus | null>(null)
  const [showSignalPath, setShowSignalPath] = useState(false)
  const [showEndpointPicker, setShowEndpointPicker] = useState(false)
  const [online, setOnline] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const browserPlayer = useBrowserPlayer()
  const [endpoint] = useSelectedEndpoint()
  const [browserTrackName, setBrowserTrackName] = useState<string | null>(null)

  // HTTP polling fallback — used until the realtime socket connects, and
  // again if it drops, so the bar never goes silently stale.
  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/lucid/status', { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const data = await r.json()
        if (data.online === false || data.error) {
          setOnline(false)
        } else {
          setOnline(true)
          setStatus(data)
        }
      } else {
        setOnline(false)
      }
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    poll()
    const pollId = setInterval(poll, 2000)

    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/state`)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        try {
          const sp: SignalPathState = JSON.parse(ev.data)
          setOnline(true)
          setStatus(prev => ({
            signal_path: sp,
            queue: prev?.queue ?? { tracks: [], position: 0, current: null },
            online: true,
          }))
        } catch {
          // malformed frame — ignore, next push will recover state
        }
      }
      ws.onclose = () => {
        if (cancelled) return
        reconnectTimer = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }
    connect()

    return () => {
      cancelled = true
      clearInterval(pollId)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [poll])

  const cmd = async (path: string, body?: object) => {
    await fetch(`/api/lucid/${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    setTimeout(poll, 300)
  }

  // The browser is just another endpoint — when it's selected and has a
  // track loaded, show metadata for the currently playing track since the
  // player itself only knows the hash.
  useEffect(() => {
    if (!browserPlayer.currentHash) {
      setBrowserTrackName(null)
      postNowPlaying(null, null)
      return
    }
    let cancelled = false
    fetch(`/api/library/${browserPlayer.currentHash}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const title = data.title || basename(data.file_path) || browserPlayer.currentHash
        setBrowserTrackName(title)
        postNowPlaying(title, data.artist ?? null)
      })
      .catch(() => { if (!cancelled) setBrowserTrackName(browserPlayer.currentHash) })
    return () => { cancelled = true }
  }, [browserPlayer.currentHash])

  // Lucid-driven (ALSA/AirPlay) playback also feeds the Polyphony presence beacon.
  useEffect(() => {
    const current = status?.queue?.current
    postNowPlaying(current ? basename(current) : null, null)
  }, [status?.queue?.current])

  const isBrowserActive = endpoint.type === 'browser' && browserPlayer.currentHash !== null

  // Nothing to show: Lucid is offline/idle and the browser endpoint isn't playing.
  if (!isBrowserActive && (!online || !status)) return null

  const endpointPicker = showEndpointPicker && <EndpointPickerModal onClose={() => setShowEndpointPicker(false)} />

  if (isBrowserActive) {
    return (
      <>
        {endpointPicker}
        <div
          className="fixed bottom-0 md:left-56 right-0 z-30 flex items-center gap-3.5 h-14 px-5 border-t border-border shadow-[inset_0_1px_0_rgba(255,255,255,.07)]"
          style={{ background: 'linear-gradient(180deg,#1c1c21,#131316)' }}
        >
          <span className="w-4 shrink-0 text-center text-[13px] text-accent animate-panel-pulse">◉</span>

          <div className="flex-[0_1_240px] min-w-[120px] overflow-hidden">
            <p className="m-0 text-[11.5px] font-medium text-text-primary truncate">{browserTrackName ?? browserPlayer.currentHash}</p>
            <p className="m-0 mt-px text-[10px] text-text-faint truncate">
              This browser{browserPlayer.signalPath?.transcoded ? ' · transcoded' : ''}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => browserPlayer.isPlaying ? browserPlayer.pause() : browserPlayer.resume()}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-[0_0_13px_rgba(109,40,217,.45)] hover:brightness-110 transition-[filter]"
              style={{ background: '#6d28d9' }}
            >
              {browserPlayer.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button onClick={() => browserPlayer.stop()} className="p-1.5 rounded-lg text-text-faint hover:text-accent transition-colors">
              <StopIcon />
            </button>
          </div>

          <TimeBadge value={formatTime(browserPlayer.currentTime)} />
          <WaveformScrubber
            hash={browserPlayer.currentHash}
            positionMs={browserPlayer.currentTime}
            durationMs={browserPlayer.duration}
            onSeek={browserPlayer.seek}
          />
          <TimeBadge value={formatTime(browserPlayer.duration)} dim />

          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <select
              value={browserPlayer.quality}
              onChange={e => browserPlayer.setQuality(e.target.value as StreamQuality)}
              title="Network-adaptive streaming quality"
              className="rounded-md border border-[#3f3f46] px-2 py-1 text-[10px] text-text-secondary focus:outline-none focus:border-accent-dim"
              style={{ background: '#131316' }}
            >
              {QUALITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <DockButton onClick={() => setShowEndpointPicker(true)}>
              <span className="flex items-center gap-1.5"><SpeakerIcon />{endpointLabel(endpoint)}</span>
            </DockButton>
          </div>
        </div>
      </>
    )
  }

  const sp = status!.signal_path
  const playing = sp.status === 'playing'
  const hasTrack = sp.source_file !== null
  const trackName = basename(sp.source_file)
  const queueLen = status!.queue.tracks.length
  const queuePos = status!.queue.position

  return (
    <>
      {endpointPicker}

      {/* Signal Path — full-screen Glass-Box overlay */}
      {showSignalPath && hasTrack && (
        <div
          className="fixed inset-0 z-[55] flex flex-col overflow-hidden px-7 py-6 backdrop-blur-[2px]"
          style={{ background: 'radial-gradient(circle at 50% 40%, rgba(24,16,48,.97), rgba(6,6,8,.985))' }}
        >
          <div className="flex items-start gap-4">
            <div className="min-w-0">
              <p className="m-0 text-[10px] uppercase tracking-[.28em] text-accent">Signal path</p>
              <p className="m-0 mt-1 text-lg font-semibold text-text-primary truncate">{trackName}</p>
              <p className="m-0 mt-0.5 text-[10.5px] text-text-faint truncate">{sp.source_file}</p>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2.5 shrink-0">
              <BitPerfectPill bitPerfect={sp.bit_perfect} />
              <DockButton onClick={() => setShowSignalPath(false)}>Close ✕</DockButton>
            </div>
          </div>

          <div className="flex flex-1 items-start justify-center min-h-0 overflow-y-auto py-4">
            <div className="flex w-full max-w-[1080px] flex-col gap-3.5">
              <SignalPath signalPath={sp} />

              <div className="rounded-[10px] border border-border px-4 py-3" style={{ background: 'rgba(16,16,18,.85)' }}>
                <div className="flex justify-between mb-2">
                  <p className="m-0 text-[9px] uppercase tracking-[.2em] text-text-ghost">Position</p>
                  <p className="m-0 text-[10px] text-text-faint">
                    {formatTime(sp.position_ms)} / {formatTime(sp.duration_ms)}
                  </p>
                </div>
                <WaveformScrubber hash={null} positionMs={sp.position_ms} durationMs={sp.duration_ms} onSeek={ms => cmd('seek', { ms })} />
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[10px] border border-border px-3 py-2.5" style={{ background: 'rgba(16,16,18,.85)' }}>
                  <p className="m-0 mb-1 text-[9px] uppercase tracking-[.16em] text-text-ghost">Queue</p>
                  <p className="m-0 text-sm font-bold tracking-[.05em] text-amber [text-shadow:0_0_10px_rgba(255,179,64,.45)]">
                    {queueLen} track{queueLen === 1 ? '' : 's'}
                  </p>
                  <p className="m-0 mt-0.5 text-[9.5px] text-text-ghost">position {queuePos + 1} of {Math.max(queueLen, 1)}</p>
                </div>
                <div className="rounded-[10px] border border-border px-3 py-2.5" style={{ background: 'rgba(16,16,18,.85)' }}>
                  <p className="m-0 mb-1 text-[9px] uppercase tracking-[.16em] text-text-ghost">DSP</p>
                  <p className="m-0 text-sm font-bold tracking-[.05em] text-amber [text-shadow:0_0_10px_rgba(255,179,64,.45)]">
                    {sp.dsp_chain.length > 0 ? sp.dsp_chain.join(' → ') : 'Bypassed'}
                  </p>
                  <p className="m-0 mt-0.5 text-[9.5px] text-text-ghost">
                    {sp.bit_perfect ? 'no resampling · no volume scaling' : 'format conversion active'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div
        className="fixed bottom-0 md:left-56 right-0 z-30 flex items-center gap-3.5 h-14 px-5 border-t border-border shadow-[inset_0_1px_0_rgba(255,255,255,.07)]"
        style={{ background: 'linear-gradient(180deg,#1c1c21,#131316)' }}
      >
        <span className={`w-4 shrink-0 text-center text-[13px] text-accent ${playing ? 'animate-panel-pulse' : 'opacity-40'}`}>◉</span>

        <div className="flex-[0_1_240px] min-w-[120px] overflow-hidden">
          <p className="m-0 text-[11.5px] font-medium text-text-primary truncate">{hasTrack ? trackName : 'Nothing playing'}</p>
          <p className="m-0 mt-px text-[10px] text-text-faint truncate">
            {hasTrack ? `Lucid → ${sp.alsa_device} · ${sp.endpoint_name ?? 'Default'}` : 'Lucid online — idle'}
          </p>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => cmd('queue/prev')} disabled={!hasTrack} className="p-1.5 rounded-lg text-text-faint hover:text-accent transition-colors disabled:opacity-30">
            <PrevIcon />
          </button>
          <button
            onClick={() => cmd(playing ? 'pause' : 'resume')}
            disabled={!hasTrack}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-[0_0_13px_rgba(109,40,217,.45)] hover:brightness-110 transition-[filter] disabled:opacity-30"
            style={{ background: '#6d28d9' }}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button onClick={() => cmd('queue/next')} disabled={!hasTrack} className="p-1.5 rounded-lg text-text-faint hover:text-accent transition-colors disabled:opacity-30">
            <NextIcon />
          </button>
          <button onClick={() => cmd('stop')} disabled={!hasTrack} className="p-1.5 rounded-lg text-text-faint hover:text-accent transition-colors disabled:opacity-30">
            <StopIcon />
          </button>
        </div>

        <TimeBadge value={hasTrack ? formatTime(sp.position_ms) : '—:—'} />
        <WaveformScrubber hash={null} positionMs={sp.position_ms} durationMs={sp.duration_ms} onSeek={ms => cmd('seek', { ms })} />
        <TimeBadge value={hasTrack ? formatTime(sp.duration_ms) : '—:—'} dim />

        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {hasTrack && <BitPerfectPill bitPerfect={sp.bit_perfect} />}
          {hasTrack && sp.source_format && sp.source_bit_depth && sp.source_sample_rate && (
            <span className="hidden xl:inline text-[10px] text-text-faint whitespace-nowrap">
              {sp.source_format.toUpperCase()} · {sp.source_bit_depth}-bit · {(sp.source_sample_rate / 1000).toFixed(1)}kHz
            </span>
          )}
          <DockButton onClick={() => setShowSignalPath(true)} active={showSignalPath}>Signal path ↑</DockButton>
          <DockButton onClick={() => setShowEndpointPicker(true)}>
            <span className="flex items-center gap-1.5"><SpeakerIcon />{endpointLabel(endpoint)}</span>
          </DockButton>
        </div>
      </div>
    </>
  )
}
