import axios from 'axios'

const MB_BASE = 'https://musicbrainz.org/ws/2'

function mbHeaders() {
  const app = process.env.MUSICBRAINZ_APP_NAME || 'Phonolith'
  const version = process.env.MUSICBRAINZ_APP_VERSION || '1.0'
  const contact = process.env.MUSICBRAINZ_CONTACT || 'user@example.com'
  return {
    'User-Agent': `${app}/${version} ( ${contact} )`,
    'Accept': 'application/json',
  }
}

// Simple 1 req/sec rate limiter
let lastCall = 0
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const wait = Math.max(0, 1000 - (now - lastCall))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastCall = Date.now()
  return fn()
}

export interface MBArtist {
  id: string
  name: string
  'sort-name': string
  disambiguation?: string
}

export interface MBRecording {
  id: string
  title: string
  length?: number
  releases?: Array<{ id: string; title: string; date?: string }>
}

export async function searchArtist(name: string): Promise<MBArtist | null> {
  return rateLimited(async () => {
    const res = await axios.get(`${MB_BASE}/artist`, {
      headers: mbHeaders(),
      params: { query: `artist:${name}`, limit: 1, fmt: 'json' },
    })
    const artists = res.data.artists as MBArtist[]
    return artists?.[0] ?? null
  })
}

export async function lookupArtist(mbid: string): Promise<MBArtist | null> {
  return rateLimited(async () => {
    const res = await axios.get(`${MB_BASE}/artist/${mbid}`, {
      headers: mbHeaders(),
      params: { fmt: 'json' },
    })
    return res.data as MBArtist
  })
}

export async function lookupRecording(mbid: string): Promise<MBRecording | null> {
  return rateLimited(async () => {
    const res = await axios.get(`${MB_BASE}/recording/${mbid}`, {
      headers: mbHeaders(),
      params: { inc: 'releases', fmt: 'json' },
    })
    return res.data as MBRecording
  })
}

export async function searchRecording(title: string, artist: string): Promise<MBRecording | null> {
  return rateLimited(async () => {
    const res = await axios.get(`${MB_BASE}/recording`, {
      headers: mbHeaders(),
      params: {
        query: `recording:${title} AND artist:${artist}`,
        limit: 1,
        fmt: 'json',
      },
    })
    const recordings = res.data.recordings as MBRecording[]
    return recordings?.[0] ?? null
  })
}
