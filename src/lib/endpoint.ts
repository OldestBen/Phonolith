'use client'

import { useEffect, useState } from 'react'

// The active output endpoint, mirroring Roon's device picker: ALSA exclusive
// or AirPlay are real Lucid-managed devices, "browser" is this tab decoding
// locally via Web Audio (the RAAT-style baseline, no hardware required).
export type Endpoint =
  | { type: 'browser' }
  | { type: 'alsa'; device: string }
  | { type: 'airplay'; name: string }

const STORAGE_KEY = 'phonolith:endpoint'
export const DEFAULT_ENDPOINT: Endpoint = { type: 'browser' }

type Listener = (endpoint: Endpoint) => void
const listeners = new Set<Listener>()

export function getSelectedEndpoint(): Endpoint {
  if (typeof window === 'undefined') return DEFAULT_ENDPOINT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_ENDPOINT
    return JSON.parse(raw) as Endpoint
  } catch {
    return DEFAULT_ENDPOINT
  }
}

export function setSelectedEndpoint(endpoint: Endpoint): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoint))
  }
  listeners.forEach(fn => fn(endpoint))
}

/** Subscribe to endpoint changes made elsewhere in this tab. Returns an unsubscribe fn. */
export function subscribeEndpoint(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function endpointLabel(endpoint: Endpoint): string {
  switch (endpoint.type) {
    case 'browser': return 'This Browser'
    case 'alsa': return endpoint.device === 'default' ? 'ALSA (default)' : `ALSA: ${endpoint.device}`
    case 'airplay': return `AirPlay: ${endpoint.name}`
  }
}

/** Reactively read the selected endpoint, updating when it changes anywhere in this tab. */
export function useSelectedEndpoint(): [Endpoint, (e: Endpoint) => void] {
  const [endpoint, setEndpointState] = useState<Endpoint>(DEFAULT_ENDPOINT)

  useEffect(() => {
    setEndpointState(getSelectedEndpoint())
    return subscribeEndpoint(setEndpointState)
  }, [])

  return [endpoint, setSelectedEndpoint]
}
