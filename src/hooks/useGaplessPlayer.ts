'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Browser playback endpoint — the RAAT model applied to the Web Audio API.
 *
 * Tracks are fetched whole from Lucid's `/stream/{hash}` passthrough endpoint
 * and decoded via `decodeAudioData`, then scheduled on a single AudioContext
 * clock with `AudioBufferSourceNode.start(when)`. Starting the next buffer at
 * the exact sample the current one ends (rather than reacting to an `ended`
 * event) is what makes the transition gapless — there is no JS-timer jitter
 * in the critical path.
 *
 * The next track is pre-fetched and pre-decoded as soon as the current one
 * starts, so it's ready well before playback reaches the boundary.
 */

export interface BrowserSignalPath {
  sourceFormat: string | null
  sourceSampleRate: number | null
  sourceChannels: number | null
  outputSampleRate: number
  bitPerfect: boolean
  transcoded: boolean
}

// 'lossless' passes the original file through unmodified. The opus-* options
// ask Lucid to transcode on the fly (see lucid/main.py's /stream endpoint),
// trading fidelity for bandwidth — intended for constrained links like
// cellular, not as a default.
export type StreamQuality = 'lossless' | 'opus-32' | 'opus-64' | 'opus-96' | 'opus-128'

interface ScheduledTrack {
  hash: string
  buffer: AudioBuffer
}

export interface GaplessPlayer {
  isPlaying: boolean
  currentHash: string | null
  currentTime: number
  duration: number
  signalPath: BrowserSignalPath | null
  error: string | null
  quality: StreamQuality
  playQueue: (hashes: string[]) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  seek: (ms: number) => void
  setVolume: (v: number) => void
  setQuality: (q: StreamQuality) => void
}

function streamUrl(hash: string, quality: StreamQuality): string {
  if (quality === 'lossless') return `/stream/${hash}`
  const bitrate = quality.split('-')[1]
  return `/stream/${hash}?format=opus&bitrate=${bitrate}`
}

async function fetchAndDecode(ctx: AudioContext, hash: string, quality: StreamQuality): Promise<AudioBuffer> {
  const res = await fetch(streamUrl(hash, quality))
  if (!res.ok) throw new Error(`Stream fetch failed (${res.status})`)
  const arrayBuffer = await res.arrayBuffer()
  return ctx.decodeAudioData(arrayBuffer)
}

export function useGaplessPlayer(): GaplessPlayer {
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAtCtxTimeRef = useRef(0)
  const queueRef = useRef<string[]>([])
  const queueIndexRef = useRef(0)
  const nextTrackRef = useRef<ScheduledTrack | null>(null)
  const currentTrackRef = useRef<ScheduledTrack | null>(null)
  const qualityRef = useRef<StreamQuality>('lossless')

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentHash, setCurrentHash] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [signalPath, setSignalPath] = useState<BrowserSignalPath | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quality, setQualityState] = useState<StreamQuality>('lossless')

  const ensureContext = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      const ctx = new AudioContext()
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      ctxRef.current = ctx
      gainRef.current = gain
    }
    return ctxRef.current
  }, [])

  const describeSignalPath = useCallback((ctx: AudioContext, buffer: AudioBuffer, hash: string) => {
    const transcoded = qualityRef.current !== 'lossless'
    setSignalPath({
      sourceFormat: transcoded ? 'OPUS' : hash.split('.').pop()?.toUpperCase() ?? null,
      sourceSampleRate: buffer.sampleRate,
      sourceChannels: buffer.numberOfChannels,
      outputSampleRate: ctx.sampleRate,
      // The browser's AudioContext runs at the OS output device rate. If that
      // differs from the source file's native rate, the OS/AudioContext is
      // resampling — playback is honest about that rather than implying
      // bit-perfect output it cannot guarantee. A network-adaptive transcode
      // is never bit-perfect regardless of sample rate match.
      bitPerfect: !transcoded && buffer.sampleRate === ctx.sampleRate,
      transcoded,
    })
  }, [])

  const scheduleNext = useCallback((ctx: AudioContext, track: ScheduledTrack, when: number, offset = 0) => {
    const node = ctx.createBufferSource()
    node.buffer = track.buffer
    node.connect(gainRef.current!)
    node.start(when, offset)
    sourceRef.current = node
    currentTrackRef.current = track
    startedAtCtxTimeRef.current = when - offset
    setCurrentHash(track.hash)
    setDuration(track.buffer.duration * 1000)
    describeSignalPath(ctx, track.buffer, track.hash)

    node.onended = () => {
      // A quality switch stops the old node and starts a new one at the
      // same queue index — that's not a track advance, so ignore it here.
      if (sourceRef.current !== node) return
      const idx = queueIndexRef.current + 1
      if (idx >= queueRef.current.length) {
        setIsPlaying(false)
        return
      }
      queueIndexRef.current = idx
      const pending = nextTrackRef.current
      nextTrackRef.current = null
      if (pending && pending.hash === queueRef.current[idx]) {
        scheduleNext(ctx, pending, ctx.currentTime)
        prefetchNext(ctx)
      } else {
        // Pre-decode missed the deadline (slow network) — fall back to a
        // best-effort immediate fetch rather than silently stopping.
        fetchAndDecode(ctx, queueRef.current[idx], qualityRef.current)
          .then(buffer => scheduleNext(ctx, { hash: queueRef.current[idx], buffer }, ctx.currentTime))
          .catch(err => setError(String(err)))
      }
    }
  }, [describeSignalPath])

  const prefetchNext = useCallback((ctx: AudioContext) => {
    const idx = queueIndexRef.current + 1
    if (idx >= queueRef.current.length) return
    const hash = queueRef.current[idx]
    fetchAndDecode(ctx, hash, qualityRef.current)
      .then(buffer => { nextTrackRef.current = { hash, buffer } })
      .catch(err => setError(String(err)))
  }, [])

  const playQueue = useCallback(async (hashes: string[]) => {
    setError(null)
    if (hashes.length === 0) return
    const ctx = ensureContext()
    await ctx.resume()

    queueRef.current = hashes
    queueIndexRef.current = 0
    nextTrackRef.current = null
    // Clear onended before stopping: otherwise the outgoing node's track-advance
    // handler can fire mid-switch and schedule the wrong track from the new queue.
    if (sourceRef.current) {
      sourceRef.current.onended = null
      sourceRef.current.stop()
    }

    try {
      const buffer = await fetchAndDecode(ctx, hashes[0], qualityRef.current)
      scheduleNext(ctx, { hash: hashes[0], buffer }, ctx.currentTime)
      setIsPlaying(true)
      prefetchNext(ctx)
    } catch (err) {
      setError(String(err))
    }
  }, [ensureContext, scheduleNext, prefetchNext])

  const setQuality = useCallback((q: StreamQuality) => {
    qualityRef.current = q
    setQualityState(q)
    nextTrackRef.current = null

    const ctx = ctxRef.current
    const hash = queueRef.current[queueIndexRef.current]
    if (!ctx || !hash) return

    // Re-fetch the current track at the new quality and resume from the
    // same playback position, rather than restarting from the top.
    const elapsed = ctx.currentTime - startedAtCtxTimeRef.current
    fetchAndDecode(ctx, hash, q)
      .then(buffer => {
        sourceRef.current?.stop()
        scheduleNext(ctx, { hash, buffer }, ctx.currentTime, Math.max(0, elapsed))
        prefetchNext(ctx)
      })
      .catch(err => setError(String(err)))
  }, [scheduleNext, prefetchNext])

  const pause = useCallback(() => {
    ctxRef.current?.suspend()
    setIsPlaying(false)
  }, [])

  const resume = useCallback(() => {
    ctxRef.current?.resume()
    setIsPlaying(true)
  }, [])

  const stop = useCallback(() => {
    const node = sourceRef.current
    if (node) {
      node.onended = null  // don't let stop() trip the track-advance handler
      node.stop()
    }
    sourceRef.current = null
    currentTrackRef.current = null
    queueRef.current = []
    nextTrackRef.current = null
    setIsPlaying(false)
    setCurrentHash(null)
    setSignalPath(null)
  }, [])

  // Seek within the current track. The whole track is already decoded into an
  // AudioBuffer, so this is instant and needs no network round-trip: an
  // AudioBufferSourceNode can't have its position moved, so we stop the current
  // node and start a fresh one from the requested offset (the same trick
  // setQuality uses). Playback keeps its play/pause state across the seek.
  const seek = useCallback((ms: number) => {
    const ctx = ctxRef.current
    const track = currentTrackRef.current
    const node = sourceRef.current
    if (!ctx || !track || !node) return

    const offset = Math.max(0, Math.min(ms / 1000, track.buffer.duration))
    const wasPlaying = isPlaying

    node.onended = null  // this stop() is a seek, not a track advance
    try { node.stop() } catch { /* already stopped */ }

    scheduleNext(ctx, track, ctx.currentTime, offset)
    setCurrentTime(offset * 1000)
    // scheduleNext starts the node immediately; if we were paused, re-suspend so
    // the seek doesn't secretly resume playback.
    if (!wasPlaying) ctx.suspend()
  }, [scheduleNext, isPlaying])

  const setVolume = useCallback((v: number) => {
    if (gainRef.current) gainRef.current.gain.value = Math.max(0, Math.min(1, v))
  }, [])

  // currentTime is derived from the AudioContext clock, not a timer — it
  // stays accurate even if the tab is backgrounded and timers are throttled.
  const readCurrentTime = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !isPlaying) return currentTime
    return (ctx.currentTime - startedAtCtxTimeRef.current) * 1000
  }, [isPlaying, currentTime])

  // Drive a ~4 Hz re-render while playing so the position readout and seek bar
  // advance smoothly, instead of only jumping when some other state changes.
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      const ctx = ctxRef.current
      if (ctx) setCurrentTime((ctx.currentTime - startedAtCtxTimeRef.current) * 1000)
    }, 250)
    return () => clearInterval(id)
  }, [isPlaying])

  return {
    isPlaying,
    currentHash,
    currentTime: readCurrentTime(),
    duration,
    signalPath,
    error,
    quality,
    playQueue,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    setQuality,
  }
}
