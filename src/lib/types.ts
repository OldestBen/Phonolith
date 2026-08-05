export interface Artist {
  id: number
  genius_id: number
  mb_id?: string
  name: string
  image_url?: string
  description?: string
  followers?: number
  fetched_at?: string
}

export interface Album {
  id: number
  genius_id?: number
  mb_id?: string
  artist_id?: number
  name: string
  cover_art_url?: string
  release_date?: string
  fetched_at?: string
}

export interface Song {
  id: number
  genius_id: number
  mb_id?: string
  artist_id?: number
  album_id?: number
  title: string
  full_title?: string
  path?: string
  release_date?: string
  song_art_image_url?: string
  description?: string
  pageviews?: number
  fetched_at?: string
  // Joined fields
  artist_name?: string
  album_name?: string
  album_cover_art_url?: string
  tags?: Tag[]
}

export interface Lyrics {
  song_id: number
  content: string
  synced_lyrics?: string | null
  scraped_at: string
}

export interface Credit {
  id: number
  song_id: number
  role: string
  name: string
  genius_id?: number
}

export interface Annotation {
  id: number
  song_id: number
  fragment: string
  body: string
  source: 'genius' | 'user'
  created_at: string
}

export interface Track {
  id: string  // UUID
  mb_recording_id?: string
  acoustid?: string
  song_id?: number
  title?: string
  disc_number: number
  track_number?: number
  duration_ms?: number
  year?: string
  album_name?: string
  artist_name?: string
  created_at: string
}

export interface Contributor {
  id: number
  name: string
  mb_artist_id?: string
  genius_id?: number
}

export interface TrackContribution {
  track_id: string
  contributor_id: number
  contributor_name: string
  role: string
}

export interface User {
  id: number
  username: string
  role: 'admin' | 'viewer'
  created_at: string
}

export interface LibrarySource {
  id: number
  name: string
  type: 'local' | 'smb' | 'nfs' | 'iscsi'
  config: Record<string, string>
  enabled: boolean
  status: 'ok' | 'offline' | 'error'
  root_marker_uuid?: string
  last_seen_at?: string
  offline_since?: string
  last_scanned_at?: string | null
  created_at: string
}

export interface LibraryFile {
  id: number
  blake3_hash: string
  file_path: string  // deprecated, kept for backwards compat
  song_id?: number
  format?: string
  bitrate?: number
  sample_rate?: number
  bit_depth?: number
  duration_ms?: number
  dr_score?: number
  spectral_ok?: boolean
  waveform_path?: string
  fingerprint?: string
  accuraterip_status?: string
  accuraterip_confidence?: number
  mb_release_group_id?: string
  indexed_at: string
  // Joined
  song_title?: string
  song_artist?: string
  album_name?: string
  album_id?: number
  // New Tier 0 fields
  track_id?: string
  source_id?: number
  relative_path?: string
  disc_number?: number
  track_number?: number
  title?: string        // embedded tag (may differ from matched song title)
  artist?: string
  album?: string
  year?: string
  engineer?: string
  inode?: number
  file_size?: number
  mtime?: number
  cover_art_path?: string
  source_online?: boolean
  metadata_locked?: boolean
  metadata_overrides?: Record<string, unknown>
}

export interface AlbumSummary {
  album_id?: number | null
  album: string
  artist: string
  year?: string
  track_count: number
  cover_hash?: string
  has_cover: boolean
}

export interface Tag {
  id: number
  name: string
  color: string
  created_at: string
}

export interface HistoryEvent {
  id: number
  song_id?: number
  artist_id?: number
  track_id?: string
  user_id?: number
  event: 'lyrics_read' | 'lyrics_download' | 'lyrics_marked_read' | 'annotation_added' | 'play'
  created_at: string
  // Joined
  song_title?: string
  artist_name?: string
}

export interface VizNode {
  id: number
  type: 'album' | 'song'
  label: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  albumId?: number
  pageviews?: number
  release_date?: string
}

export interface VizConnections {
  collaborator: [number, number][]
  producer: [number, number][]
  era: [number, number][]
}

// ── Engram ─────────────────────────────────────────────────────────────────────

export interface MetadataVersion {
  id: number
  blake3_hash: string
  snapshot: Record<string, unknown>
  source: 'ingest' | 'user' | 'lexicon' | 'musicbrainz' | 'restore'
  note?: string
  created_at: string
}

// ── Lucid / Signal Path ────────────────────────────────────────────────────────

export interface SignalPathState {
  source_file: string | null
  source_format: string | null
  source_bit_depth: number | null
  source_sample_rate: number | null
  source_channels: number
  decoder: string | null
  dsp_chain: string[]
  transport: string
  alsa_device: string
  endpoint_name: string | null
  status: 'playing' | 'paused' | 'stopped' | 'buffering' | 'error'
  position_ms: number
  duration_ms: number
  volume: number
  bit_perfect: boolean
}

export interface LucidStatus {
  signal_path: SignalPathState
  queue: {
    tracks: string[]
    position: number
    current: string | null
  }
  online: boolean
}

export interface AlsaDevice {
  name: string
  label: string
}

// ── Cathode ────────────────────────────────────────────────────────────────────

export interface HardwareProfile {
  id: number
  name: string
  description?: string
  device_type: 'dac' | 'amp' | 'speaker' | 'headphone' | 'dap' | 'system'
  components: Array<{ role: string; model: string }>
  total_hours: number
  lucid_device?: string
  created_at: string
}
