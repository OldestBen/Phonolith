'use client'

import { createContext, useContext } from 'react'
import { useGaplessPlayer, type GaplessPlayer } from '@/hooks/useGaplessPlayer'

/**
 * A single, app-wide instance of the browser playback endpoint (one
 * AudioContext, one queue). Without this, every component that called
 * useGaplessPlayer() directly would get its own independent player —
 * starting playback on the file detail page wouldn't be visible or
 * controllable from the PlaybackBar, which defeats the point of treating
 * "this browser tab" as a real output endpoint alongside ALSA/AirPlay.
 */
const BrowserPlayerCtx = createContext<GaplessPlayer | null>(null)

export function BrowserPlayerProvider({ children }: { children: React.ReactNode }) {
  const player = useGaplessPlayer()
  return <BrowserPlayerCtx.Provider value={player}>{children}</BrowserPlayerCtx.Provider>
}

export function useBrowserPlayer(): GaplessPlayer {
  const ctx = useContext(BrowserPlayerCtx)
  if (!ctx) throw new Error('useBrowserPlayer must be used within BrowserPlayerProvider')
  return ctx
}
