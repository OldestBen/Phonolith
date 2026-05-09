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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface SankeyData {
  nodes: { name: string }[]
  links: { source: number; target: number; value: number }[]
  periods: number[]
}

export function getGenreEvolution(): Promise<SankeyData> {
  return apiFetch('/api/analytics/genre-evolution')
}

export interface BpmKeyMismatch {
  hash: string
  path: string
  title?: string
  artist?: string
  album?: string
  tag_bpm?: number
  detected_bpm?: number
  tag_key?: string
  detected_key?: string
  bpm_delta: number
}

export function getBpmKeyMismatches(): Promise<BpmKeyMismatch[]> {
  return apiFetch('/api/analytics/bpm-key-mismatches')
}

export interface MasteringEngineer {
  credit: string
  track_count: number
  avg_dr: number | null
  avg_rating: number | null
  avg_peak: number | null
  avg_rms: number | null
  lossless_count: number
  library_pct: number
}

export function getMasteringEngineers(): Promise<MasteringEngineer[]> {
  return apiFetch('/api/analytics/mastering-engineers')
}

export function getEngineerTracks(credit: string): Promise<Track[]> {
  return apiFetch(`/api/analytics/mastering-engineers/${encodeURIComponent(credit)}/tracks`)
}

export async function playTrack(hash: string, endpointId?: string): Promise<void> {
  await apiFetch('/api/playback/play', {
    method: 'POST',
    body: JSON.stringify({ hash, endpoint_id: endpointId ?? null, validate_hash: true }),
  })
}

export async function streamToAirPlay(hash: string, endpointId: string): Promise<void> {
  await apiFetch('/api/flux/stream', {
    method: 'POST',
    body: JSON.stringify({ hash, endpoint_id: endpointId }),
  })
}

export async function stopAirPlay(endpointId: string): Promise<void> {
  await apiFetch(`/api/flux/stop?endpoint_id=${encodeURIComponent(endpointId)}`, { method: 'POST' })
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

export interface WaveformData {
  resolution: number
  sample_rate: number
  duration_seconds: number
  peaks: number[]
  rms: number[]
  blake3_hash: string
  path: string
}

export function getWaveform(hash: string): Promise<WaveformData> {
  return apiFetch(`/api/waveform/${encodeURIComponent(hash)}`)
}

export function getProxyUrl(hash: string): string {
  return `/api/proxy/${encodeURIComponent(hash)}?proxy=1`
}

export interface SemanticTrack {
  blake3_hash: string
  path: string
  bpm: number
  key_index: number
  spectral_centroid: number
  rms_energy: number
  duration_seconds?: number
  similarity?: number
}

export interface SemanticParams {
  min_bpm?: number
  max_bpm?: number
  key?: number
  min_energy?: number
  max_energy?: number
  limit?: number
}

export function searchSimilar(hash: string, limit = 10): Promise<SemanticTrack[]> {
  return apiFetch(`/api/search/similar/${encodeURIComponent(hash)}?limit=${limit}`)
}

export function searchSemantic(params: SemanticParams): Promise<SemanticTrack[]> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v))
  }
  return apiFetch(`/api/search/semantic?${qs}`)
}

// --- Data Janitor ---

export interface SilentTrack {
  hash: string
  path: string
  filename?: string
  title?: string
  artist?: string
  album?: string
  year?: number
  peak_level?: number
  rms_level?: number
  duration_seconds?: number
  dr_score?: number
  format?: string
}

export interface ArtworkIssue {
  id: string
  album: string
  artist?: string
  artwork_path?: string
  artwork_width?: number
  artwork_height?: number
  track_count: number
  issue: 'missing' | 'low_res'
}

export interface DiscIssue {
  album: string
  artist?: string
  track_count: number
  max_track_number?: number
  tagged_disc_count: number
  untagged_disc_count: number
}

export function getJanitorSilentTracks(peakThreshold = -50, rmsThreshold = -60): Promise<SilentTrack[]> {
  return apiFetch(`/api/janitor/silent-tracks?peak_threshold=${peakThreshold}&rms_threshold=${rmsThreshold}`)
}

export function getJanitorArtworkAudit(minDimension = 500): Promise<ArtworkIssue[]> {
  return apiFetch(`/api/janitor/artwork-audit?min_dimension=${minDimension}`)
}

export function getJanitorMissingDisc(): Promise<DiscIssue[]> {
  return apiFetch('/api/janitor/missing-disc')
}

// --- Smart Playlists ---

export interface PlaylistFilters {
  min_dr?: number
  max_dr?: number
  min_bpm?: number
  max_bpm?: number
  key?: string
  genre?: string
  min_year?: number
  max_year?: number
  min_rating?: number
  format?: string
  engineer?: string
  lossless_only?: boolean
}

export interface PlaylistTrack {
  hash: string
  path: string
  title?: string
  artist?: string
  album?: string
  year?: number
  format?: string
  bit_depth?: number
  sample_rate?: number
  dr_score?: number
  internal_rating?: number
  bpm?: number
  key?: string
}

export function getPlaylistPreview(filters: PlaylistFilters, limit = 200): Promise<PlaylistTrack[]> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v))
  }
  if (filters.lossless_only) qs.set('lossless_only', 'true')
  qs.set('limit', String(limit))
  return apiFetch(`/api/playlists/preview?${qs}`)
}

export function getPlaylistM3uUrl(filters: PlaylistFilters, name: string): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v))
  }
  if (filters.lossless_only) qs.set('lossless_only', 'true')
  qs.set('name', name)
  return `/api/playlists/export.m3u?${qs}`
}

// --- Polyphony ---

export interface PendingFix {
  id: string
  blake3_hash: string
  field: string
  old_value?: string
  new_value: string
  peer_alias: string
  received_at: string
  status: 'pending' | 'approved' | 'rejected'
  track_title?: string
  track_artist?: string
}

export interface PeerNode {
  id: string
  alias: string
  wireguard_endpoint?: string
  last_seen_at?: string
  is_trusted: boolean
  shared_track_count: number
}

export function getPendingFixes(status = 'pending'): Promise<PendingFix[]> {
  return apiFetch(`/api/polyphony/fixes?status=${status}`)
}

export function decideFix(fixId: string, action: 'approve' | 'reject'): Promise<{ status: string }> {
  return apiFetch('/api/polyphony/fixes/decide', {
    method: 'POST',
    body: JSON.stringify({ fix_id: fixId, action }),
  })
}

export function getPeers(): Promise<PeerNode[]> {
  return apiFetch('/api/polyphony/peers')
}

// --- Sonic Codex ---

export interface CodexStats {
  track_count: number
  artist_count: number
  album_count: number
  total_hours: number
  dr_analyzed: number
  rated_count: number
  play_event_count: number
}

export function getCodexStats(): Promise<CodexStats> {
  return apiFetch('/api/codex/stats')
}

export function getCodexExportUrl(): string {
  return '/api/codex/export'
}

// --- Cathode ---

export interface CathodeSummary {
  endpoint_id: string
  endpoint_name?: string
  endpoint_type?: string
  model?: string
  play_count: number
  hours_played: number
  top_genre?: string
  top_format?: string
  first_use?: string
  last_use?: string
}

export interface CathodeGenre {
  genre: string
  play_count: number
  hours: number
}

export interface CathodeTimeline {
  month: string
  play_count: number
  hours: number
}

export function getCathodeSummary(): Promise<CathodeSummary[]> {
  return apiFetch('/api/cathode/summary')
}

export function getCathodeGenres(endpointId: string): Promise<CathodeGenre[]> {
  return apiFetch(`/api/cathode/endpoint/${encodeURIComponent(endpointId)}/genres`)
}

export function getCathodeTimeline(endpointId: string): Promise<CathodeTimeline[]> {
  return apiFetch(`/api/cathode/endpoint/${encodeURIComponent(endpointId)}/timeline`)
}

// --- EQ Profiles ---

export interface EQProfile {
  id: string
  blake3_hash?: string
  album_id?: string
  label: string
  peq_json?: string
  convolution_file_path?: string
  notes?: string
  created_at: string
}

export function getEQProfiles(albumId?: string, hash?: string): Promise<EQProfile[]> {
  const qs = new URLSearchParams()
  if (albumId) qs.set('album_id', albumId)
  if (hash) qs.set('blake3_hash', hash)
  return apiFetch(`/api/eq-profiles?${qs}`)
}

export function createEQProfile(profile: Omit<EQProfile, 'id' | 'created_at'>): Promise<{ id: string }> {
  return apiFetch('/api/eq-profiles', { method: 'POST', body: JSON.stringify(profile) })
}

export function deleteEQProfile(id: string): Promise<void> {
  return apiFetch(`/api/eq-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- AirPlay Zones ---

export interface AirPlayZone {
  zone_id: string
  name: string
  endpoint_ids: string[]
}

export function createZone(zone: AirPlayZone): Promise<{ status: string }> {
  return apiFetch('/api/flux/zones', { method: 'POST', body: JSON.stringify(zone) })
}

export function deleteZone(zoneId: string): Promise<{ status: string }> {
  return apiFetch(`/api/flux/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE' })
}

export function streamToZone(zoneId: string, hash: string): Promise<{ status: string }> {
  return apiFetch('/api/flux/zones/stream', {
    method: 'POST',
    body: JSON.stringify({ zone_id: zoneId, hash }),
  })
}

export function stopZone(zoneId: string): Promise<{ status: string }> {
  return apiFetch(`/api/flux/zones/${encodeURIComponent(zoneId)}/stop`, { method: 'POST' })
}

// --- SMART Health ---

export interface SmartWarning {
  attr_id: number
  attr_name: string
  raw_value: number
}

export interface SmartReport {
  device: string
  model: string
  model_family?: string
  serial?: string
  capacity_bytes?: number
  temperature_c?: number
  power_on_hours?: number
  smart_passed: boolean
  status: 'healthy' | 'warning' | 'failed'
  critical_warnings: SmartWarning[]
  polled_at: string
}

export function getSmartReports(): Promise<SmartReport[]> {
  return apiFetch('/api/health/smart')
}

// --- Dedup ---

export interface DedupPair {
  similarity: number
  preferred: { id: string; title?: string; artist?: string; album?: string; format?: string; bit_depth?: number; size_bytes?: number; path?: string }
  duplicate:  { id: string; title?: string; artist?: string; album?: string; format?: string; bit_depth?: number; size_bytes?: number; path?: string }
}

export function getDedupCandidates(similarityFloor = 0.998): Promise<DedupPair[]> {
  return apiFetch(`/api/dedup/candidates?similarity_floor=${similarityFloor}`)
}
