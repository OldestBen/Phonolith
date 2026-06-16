import { getSetting } from './settings'

const LRCLIB_BASE = 'https://lrclib.net/api'
const TIMEOUT_MS = 5000

async function lrclibHeaders() {
  const app = process.env.MUSICBRAINZ_APP_NAME || 'Phonolith'
  const version = process.env.MUSICBRAINZ_APP_VERSION || '1.0'
  const contact = (await getSetting('MUSICBRAINZ_CONTACT')) || 'user@example.com'
  return {
    'User-Agent': `${app}/${version} ( ${contact} )`,
    'Accept': 'application/json',
  }
}

interface LRCLIBResult {
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

export interface LyricsResult {
  synced: string | null
  plain: string | null
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { headers: await lrclibHeaders(), signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function toResult(r: LRCLIBResult): LyricsResult | null {
  if (!r.syncedLyrics && !r.plainLyrics) return null
  return { synced: r.syncedLyrics ?? null, plain: r.plainLyrics ?? null }
}

export async function getLyrics(
  artist: string,
  track: string,
  album?: string,
  durationSec?: number
): Promise<LyricsResult | null> {
  const getParams = new URLSearchParams({ artist_name: artist, track_name: track })
  if (album) getParams.set('album_name', album)
  if (durationSec !== undefined) getParams.set('duration', String(Math.round(durationSec)))

  try {
    const res = await fetchWithTimeout(`${LRCLIB_BASE}/get?${getParams.toString()}`)
    if (res.ok) {
      const data = (await res.json()) as LRCLIBResult
      const result = toResult(data)
      if (result) return result
    }
    // 404 (no exact match) or an empty hit falls through to fuzzy search below.
  } catch {
    return null
  }

  try {
    const searchParams = new URLSearchParams({ q: `${artist} ${track}` })
    const res = await fetchWithTimeout(`${LRCLIB_BASE}/search?${searchParams.toString()}`)
    if (!res.ok) return null
    const data = (await res.json()) as LRCLIBResult[]
    if (!Array.isArray(data) || data.length === 0) return null
    return toResult(data[0])
  } catch {
    return null
  }
}
