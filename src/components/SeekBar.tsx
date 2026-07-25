'use client'

import { useCallback, useRef } from 'react'

/**
 * A scrubbable progress/seek bar. Supports click-to-seek and click-and-drag,
 * with a handle that appears on hover. The visible track is thin, but the hit
 * area is tall enough (h-4) to actually grab — the old 2px bars were nearly
 * impossible to click.
 *
 * Position/duration are in milliseconds; onSeek is called with the target
 * position in ms.
 */
export default function SeekBar({
  positionMs,
  durationMs,
  onSeek,
  className = '',
}: {
  positionMs: number
  durationMs: number
  onSeek: (ms: number) => void
  className?: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const pct = durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0
  const seekable = durationMs > 0

  const seekToClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current
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
      ref={barRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.floor(durationMs))}
      aria-valuenow={Math.floor(Math.max(0, positionMs))}
      className={`group relative flex h-4 items-center select-none touch-none ${seekable ? 'cursor-pointer' : 'cursor-default'} ${className}`}
    >
      <div className="relative h-1 w-full bg-accent/20">
        <div className="absolute inset-y-0 left-0 bg-accent group-hover:bg-accent/90" style={{ width: `${pct}%` }} />
        {seekable && (
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 shadow transition-opacity group-hover:opacity-100"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
    </div>
  )
}
