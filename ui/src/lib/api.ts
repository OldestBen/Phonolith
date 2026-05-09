// --- TypeScript Interfaces ---

export interface Track {
  hash: string
  path: string
  filename?: string
  title?: string
  artist?: string
  album?: string
  genre?: string
  format?: string
  bit_depth?: number
  sample_rate?: number
  duration_seconds?: number
  dr_score?: number
  internal_rating?: number
  prism_status?: 'clean' | 'suspect' | 'fraud'
  label?: string
  year?: number
  last_played_at?: string
}

export interface Album {
  album: string
  artist: string
  avg_dr_score?: number
  track_count: number
}

export interface Artist {
  artist: string
  track_count: number
  avg_dr_score?: number
}

export interface AnalyticsOverview {
  total_tracks: number
  total_albums: number
  total_artists: number
  lossless_count: number
  lossy_count: number
  avg_dr: number
  total_play_hours: number
}

export interface Snapshot {
  id: string
  hash: string
  snapshot_type: string
  captured_at: string
  metadata?: string
}

// --- Base fetch helper ---

const BASE = ''

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// --- API Functions ---

export interface TracksParams {
  page?: number
  per_page?: number
  artist?: string
  album?: string
  search?: string
  sort?: string
  order?: string
  genre?: string
}

export function getTracks(params: TracksParams = {}): Promise<{ tracks: Track[]; total: number }> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const query = qs.toString() ? `?${qs}` : ''
  return apiFetch(`/api/library/tracks${query}`)
}

export function getTrack(hash: string): Promise<Track> {
  return apiFetch(`/api/library/tracks/${encodeURIComponent(hash)}`)
}

export function getAlbums(): Promise<Album[]> {
  return apiFetch('/api/library/albums')
}

export function getArtists(): Promise<Artist[]> {
  return apiFetch('/api/library/artists')
}

export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return apiFetch('/api/analytics/overview')
}

export function getGhostReport(): Promise<Track[]> {
  return apiFetch('/api/analytics/ghost')
}

export function getLabelBreakdown(): Promise<{ label: string; count: number }[]> {
  return apiFetch('/api/analytics/label-breakdown')
}

export function getDRHeatmap(): Promise<{ dr: number; count: number }[]> {
  return apiFetch('/api/analytics/dr-heatmap')
}

export async function playTrack(hash: string, endpointId?: string): Promise<void> {
  await apiFetch('/api/playback/play', {
    method: 'POST',
    body: JSON.stringify({ hash, endpoint_id: endpointId ?? null, validate_hash: true }),
  })
}

export async function restoreSnapshot(snapshotId: string): Promise<void> {
  await apiFetch('/api/engram/restore', {
    method: 'POST',
    body: JSON.stringify({ snapshot_id: snapshotId }),
  })
}

export function getSnapshots(hash: string): Promise<Snapshot[]> {
  return apiFetch(`/api/engram/snapshots/${encodeURIComponent(hash)}`)
}
