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

export interface LibraryFile {
  id: number
  blake3_hash: string
  file_path: string
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
  event: 'lyrics_read' | 'lyrics_download' | 'play'
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
