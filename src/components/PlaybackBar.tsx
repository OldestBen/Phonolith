'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { LucidStatus, SignalPathState } from '@/lib/types'
import SignalPath from './SignalPath'
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

// ── Playback controls SVGs ────────────────────────────────────────────────────

const PrevIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
  </svg>
)

const NextIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm2.5-6l5.5 4V8l-5.5 4zM16 6h2v12h-2z" />
  </svg>
)

const PlayIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const PauseIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
)

const StopIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h12v12H6z" />
  </svg>
)

const GlassBoxIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

const SpeakerIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
)

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
    const progress = browserPlayer.duration > 0 ? (browserPlayer.currentTime / browserPlayer.duration) * 100 : 0
    return (
      <>
        {endpointPicker}
        <div className="fixed bottom-0 left-16 right-0 z-30 border-t border-border bg-surface/95 backdrop-blur-sm">
          <div className="h-0.5 bg-accent/20">
            <div className="h-full bg-accent transition-all duration-1000" style={{ width: `${progress}%` }} />
          </div>

          <div className="flex items-center gap-4 px-4 py-2.5">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-medium truncate">{browserTrackName ?? browserPlayer.currentHash}</p>
                <p className="text-text-muted text-xs font-mono">
                  {formatTime(browserPlayer.currentTime)} / {formatTime(browserPlayer.duration)} — This Browser
                  {browserPlayer.signalPath?.transcoded ? ' (transcoded)' : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => browserPlayer.isPlaying ? browserPlayer.pause() : browserPlayer.resume()}
                className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white hover:bg-accent/80 transition-colors"
              >
                {browserPlayer.isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                onClick={() => browserPlayer.stop()}
                className="p-2 rounded-lg text-text-muted hover:text-accent transition-colors"
              >
                <StopIcon />
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <select
                value={browserPlayer.quality}
                onChange={e => browserPlayer.setQuality(e.target.value as StreamQuality)}
                title="Network-adaptive streaming quality"
                className="hidden sm:block bg-surface-2 border border-border text-text-muted text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent transition-colors"
              >
                {QUALITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowEndpointPicker(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-surface-2 border-border text-text-muted hover:text-accent hover:border-accent/40 text-xs font-medium transition-colors"
              >
                <SpeakerIcon />
                <span className="hidden sm:inline">{endpointLabel(endpoint)}</span>
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  const sp = status!.signal_path
  const playing = sp.status === 'playing'
  const paused = sp.status === 'paused'
  const hasTrack = sp.source_file !== null
  const progress = sp.duration_ms > 0 ? (sp.position_ms / sp.duration_ms) * 100 : 0
  const trackName = basename(sp.source_file)

  return (
    <>
      {endpointPicker}
      {/* Glass-Box overlay */}
      {showSignalPath && (
        <div
          className="fixed inset-0 z-40 bg-background/90 backdrop-blur-sm flex items-center justify-center p-8"
          onClick={() => setShowSignalPath(false)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-8 max-w-5xl w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-text-primary text-lg font-bold">Signal Path</h2>
                <p className="text-text-muted text-xs mt-0.5">Glass-Box view — end-to-end signal chain</p>
              </div>
              <div className="flex items-center gap-3">
                {sp.bit_perfect ? (
                  <span className="px-2.5 py-1 rounded-full bg-success/10 border border-success/20 text-success text-xs font-semibold">
                    Bit-perfect
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full bg-warning/10 border border-warning/20 text-warning text-xs font-semibold">
                    Format conversion active
                  </span>
                )}
                <button
                  onClick={() => setShowSignalPath(false)}
                  className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-text-muted hover:text-accent transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <SignalPath signalPath={sp} className="justify-center" />

            {/* Technical detail table */}
            <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Sample Rate', value: sp.source_sample_rate ? `${(sp.source_sample_rate / 1000).toFixed(1)} kHz` : '—' },
                { label: 'Bit Depth', value: sp.source_bit_depth ? `${sp.source_bit_depth}-bit` : '—' },
                { label: 'Channels', value: sp.source_channels === 2 ? 'Stereo' : sp.source_channels === 1 ? 'Mono' : `${sp.source_channels}ch` },
                { label: 'Format', value: sp.source_format?.toUpperCase() ?? '—' },
                { label: 'Decoder', value: sp.decoder ?? '—' },
                { label: 'Transport', value: sp.transport },
                { label: 'Device', value: sp.alsa_device },
                { label: 'Endpoint', value: sp.endpoint_name ?? 'Default' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-background rounded-xl border border-border/50 px-4 py-3">
                  <p className="text-text-muted text-[10px] uppercase tracking-widest mb-1">{label}</p>
                  <p className="text-text-primary text-sm font-mono font-medium">{value}</p>
                </div>
              ))}
            </div>

            {/* DSP chain */}
            {sp.dsp_chain.length > 0 && (
              <div className="mt-4 p-4 bg-warning/5 border border-warning/20 rounded-xl">
                <p className="text-warning text-xs font-semibold mb-1">DSP Processing Active</p>
                <p className="text-text-muted text-xs">{sp.dsp_chain.join(' → ')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-16 right-0 z-30 border-t border-border bg-surface/95 backdrop-blur-sm">
        {/* Progress bar */}
        <div
          className="h-0.5 bg-accent/20 cursor-pointer group"
          onClick={e => {
            const pct = e.nativeEvent.offsetX / (e.currentTarget as HTMLElement).offsetWidth
            if (sp.duration_ms > 0) cmd('seek', { ms: Math.floor(pct * sp.duration_ms) })
          }}
        >
          <div
            className="h-full bg-accent transition-all duration-1000 group-hover:bg-accent/80"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Signal path — always visible, not hidden behind a toggle */}
        {hasTrack && (
          <div className="hidden lg:block px-4 pt-2 border-b border-border/40">
            <SignalPath signalPath={sp} className="scale-[0.85] origin-left" />
          </div>
        )}

        <div className="flex items-center gap-4 px-4 py-2.5">
          {/* Track info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-text-primary text-sm font-medium truncate">
                {hasTrack ? trackName : 'Nothing playing'}
              </p>
              <p className="text-text-muted text-xs font-mono">
                {hasTrack
                  ? `${formatTime(sp.position_ms)} / ${formatTime(sp.duration_ms)}`
                  : 'Lucid online — idle'}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => cmd('queue/prev')}
              disabled={!hasTrack}
              className="p-2 rounded-lg text-text-muted hover:text-accent transition-colors disabled:opacity-30"
            >
              <PrevIcon />
            </button>
            <button
              onClick={() => cmd(playing ? 'pause' : 'resume')}
              disabled={!hasTrack}
              className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white hover:bg-accent/80 transition-colors disabled:opacity-30"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              onClick={() => cmd('queue/next')}
              disabled={!hasTrack}
              className="p-2 rounded-lg text-text-muted hover:text-accent transition-colors disabled:opacity-30"
            >
              <NextIcon />
            </button>
            <button
              onClick={() => cmd('stop')}
              disabled={!hasTrack}
              className="p-2 rounded-lg text-text-muted hover:text-accent transition-colors disabled:opacity-30"
            >
              <StopIcon />
            </button>
          </div>

          {/* Format badge + Glass-Box toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {hasTrack && sp.source_bit_depth && sp.source_sample_rate && (
              <span className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border ${
                sp.bit_perfect
                  ? 'bg-success/10 border-success/20 text-success'
                  : 'bg-warning/10 border-warning/20 text-warning'
              }`}>
                {sp.source_bit_depth}bit / {(sp.source_sample_rate / 1000).toFixed(1)}kHz
                {sp.bit_perfect ? ' ●' : ' ⚠'}
              </span>
            )}
            <button
              onClick={() => setShowSignalPath(s => !s)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                showSignalPath
                  ? 'bg-accent/20 border-accent/40 text-accent'
                  : 'bg-surface-2 border-border text-text-muted hover:text-accent hover:border-accent/40'
              }`}
            >
              <GlassBoxIcon />
              <span className="hidden sm:inline">Signal Path</span>
            </button>
            <button
              onClick={() => setShowEndpointPicker(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-surface-2 border-border text-text-muted hover:text-accent hover:border-accent/40 text-xs font-medium transition-colors"
            >
              <SpeakerIcon />
              <span className="hidden sm:inline">{endpointLabel(endpoint)}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
