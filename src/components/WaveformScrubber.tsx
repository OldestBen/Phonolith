'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * The playback-bar scrubber — ported from the mockup's inline SVG dual-path
 * (peak/RMS) waveform with a clip-path "played" reveal and a playhead line.
 *
 * The mockup's shape is a fabricated demo curve; there's no numeric peak/RMS
 * array exposed to the frontend to reproduce that exactly (the analyst
 * sidecar only serves a pre-rendered PNG per track hash, drawn in the same
 * violet-on-near-black the rest of the app already uses — see
 * analyst/scanner.py's waveform renderer). So instead of inventing fake
 * sample data, this overlays the *real* per-track waveform image and reveals
 * a brighter copy of it up to the current playback position, which reads the
 * same way the mockup's clip-path trick does but is backed by real audio.
 *
 * `hash` is optional: the Lucid/ALSA "now playing" bar only knows the
 * source file's absolute path, not its content hash, so there's no waveform
 * image to fetch there. Without a hash this still renders (and stays
 * seekable) as a plain tick-marked track — no fabricated waveform shape.
 */
export default function WaveformScrubber({
  hash,
  positionMs,
  durationMs,
  onSeek,
}: {
  hash?: string | null
  positionMs: number
  durationMs: number
  onSeek: (ms: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [imgOk, setImgOk] = useState(true)

  const pct = durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0
  const seekable = durationMs > 0

  const seekToClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || durationMs <= 0) return
      const rect = el.getBoundingClientRect()
      const p = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
      onSeek(Math.floor(Math.min(1, Math.max(0, p)) * durationMs))
    },
    [durationMs, onSeek],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!seekable) return
      draggingRef.current = true
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* pointer capture unsupported — click-to-seek still works */
      }
      seekToClientX(e.clientX)
    },
    [seekable, seekToClientX],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) seekToClientX(e.clientX)
    },
    [seekToClientX],
  )

  const endDrag = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* nothing to release */
    }
  }, [])

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.floor(durationMs))}
      aria-valuenow={Math.floor(Math.max(0, positionMs))}
      className={`relative h-[26px] min-w-0 flex-1 select-none touch-none overflow-hidden rounded-sm ${seekable ? 'cursor-pointer' : 'cursor-default'}`}
      style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,.045) 0 1px, rgba(0,0,0,0) 1px 9px)' }}
    >
      {hash && imgOk && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/waveforms/${hash}`}
            alt=""
            onError={() => setImgOk(false)}
            className="absolute inset-0 h-full w-full object-cover opacity-45"
          />
          <div
            className="absolute inset-y-0 left-0 overflow-hidden"
            style={{ width: `${pct}%` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/waveforms/${hash}`}
              alt=""
              className="h-full object-cover brightness-125"
              style={{ width: trackRef.current ? trackRef.current.clientWidth : '100vw', maxWidth: 'none' }}
            />
          </div>
        </>
      )}
      {!hash && seekable && (
        <div className="absolute inset-y-0 left-0 bg-accent-dim/25" style={{ width: `${pct}%` }} />
      )}
      {seekable && (
        <div
          className="absolute inset-y-0 w-[1.5px] bg-[#c4b5fd] shadow-[0_0_5px_rgba(196,181,253,.8)]"
          style={{ left: `${pct}%` }}
        />
      )}
    </div>
  )
}
