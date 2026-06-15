import type { LucidStatus } from './types'

const LUCID_URL = process.env.LUCID_URL || 'http://lucid:8001'

async function lucidFetch(path: string, init?: RequestInit) {
  return fetch(`${LUCID_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(5000),
  })
}

export async function getLucidStatus(): Promise<LucidStatus | null> {
  try {
    const r = await lucidFetch('/status')
    if (!r.ok) return null
    const data = await r.json()
    return { ...data, online: true }
  } catch {
    return null
  }
}

export async function lucidPlay(path: string, device?: string, endpointName?: string) {
  return lucidFetch('/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, device, endpoint_name: endpointName }),
  })
}

export async function lucidPause() {
  return lucidFetch('/pause', { method: 'POST' })
}

export async function lucidResume() {
  return lucidFetch('/resume', { method: 'POST' })
}

export async function lucidStop() {
  return lucidFetch('/stop', { method: 'POST' })
}

export async function lucidSeek(ms: number) {
  return lucidFetch('/seek', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms }),
  })
}

export async function getDevices() {
  try {
    const r = await lucidFetch('/devices')
    return r.ok ? r.json() : { alsa: [], airplay: [] }
  } catch {
    return { alsa: [], airplay: [] }
  }
}
