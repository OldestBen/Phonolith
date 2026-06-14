import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://api.genius.com'

function headers() {
  return { Authorization: `Bearer ${process.env.GENIUS_ACCESS_TOKEN}` }
}

export interface GeniusArtist {
  id: number
  name: string
  image_url: string
  header_image_url?: string
  description?: string
  followers_count?: number
}

export interface GeniusAlbum {
  id: number
  name: string
  cover_art_url: string
  release_date_components?: { year?: number; month?: number; day?: number }
}

export interface GeniusSong {
  id: number
  title: string
  full_title: string
  path: string
  url: string
  release_date?: string
  release_date_components?: { year?: number; month?: number; day?: number }
  song_art_image_url?: string
  header_image_url?: string
  pageviews?: number
  description?: string
  primary_artist: GeniusArtist
  album?: GeniusAlbum
  featured_artists: GeniusArtist[]
  producer_artists: GeniusArtist[]
  writer_artists: GeniusArtist[]
  custom_performances: Array<{ label: string; artists: GeniusArtist[] }>
}

export async function searchArtists(query: string): Promise<GeniusArtist[]> {
  const res = await axios.get(`${BASE_URL}/search`, {
    headers: headers(),
    params: { q: query, per_page: 20 },
  })
  const hits = res.data.response.hits as Array<{ type: string; result: { primary_artist: GeniusArtist } }>
  const seen = new Set<number>()
  const artists: GeniusArtist[] = []
  for (const hit of hits) {
    if (hit.type !== 'song') continue
    const a = hit.result.primary_artist
    if (!seen.has(a.id)) {
      seen.add(a.id)
      artists.push(a)
    }
  }
  return artists
}

export async function getArtist(id: number): Promise<GeniusArtist> {
  const res = await axios.get(`${BASE_URL}/artists/${id}`, { headers: headers() })
  const a = res.data.response.artist
  return {
    id: a.id,
    name: a.name,
    image_url: a.image_url,
    header_image_url: a.header_image_url,
    description: a.description?.plain,
    followers_count: a.followers_count,
  }
}

export async function getAllSongs(artistId: number): Promise<GeniusSong[]> {
  const songs: GeniusSong[] = []
  let page = 1
  while (page <= 30) {
    const res = await axios.get(`${BASE_URL}/artists/${artistId}/songs`, {
      headers: headers(),
      params: { per_page: 50, page, sort: 'release_date' },
    })
    const batch = res.data.response.songs as GeniusSong[]
    if (!batch || batch.length === 0) break
    songs.push(...batch)
    if (batch.length < 50) break
    page++
  }
  return songs
}

export async function getSongs(artistId: number, page = 1): Promise<GeniusSong[]> {
  const res = await axios.get(`${BASE_URL}/artists/${artistId}/songs`, {
    headers: headers(),
    params: { per_page: 50, page, sort: 'release_date' },
  })
  return res.data.response.songs as GeniusSong[]
}

export async function getSong(id: number): Promise<GeniusSong> {
  const res = await axios.get(`${BASE_URL}/songs/${id}`, {
    headers: headers(),
    params: { text_format: 'plain' },
  })
  const s = res.data.response.song
  return {
    id: s.id,
    title: s.title,
    full_title: s.full_title,
    path: s.path,
    url: s.url,
    release_date: s.release_date,
    release_date_components: s.release_date_components,
    song_art_image_url: s.song_art_image_url,
    header_image_url: s.header_image_url,
    pageviews: s.stats?.pageviews,
    description: s.description?.plain,
    primary_artist: s.primary_artist,
    album: s.album,
    featured_artists: s.featured_artists || [],
    producer_artists: s.producer_artists || [],
    writer_artists: s.writer_artists || [],
    custom_performances: s.custom_performances || [],
  }
}

export async function scrapeLyrics(path: string): Promise<string> {
  const url = `https://genius.com${path}`
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  const $ = cheerio.load(res.data)
  $('br').replaceWith('\n')
  const containers = $('[data-lyrics-container="true"]')
  if (containers.length === 0) {
    // Fallback: try the old class
    return $('.lyrics').text().trim()
  }
  const parts: string[] = []
  containers.each((_, el) => {
    parts.push($(el).text())
  })
  return parts.join('\n\n').trim()
}

export async function scrapeAnnotations(path: string): Promise<Array<{ fragment: string; body: string }>> {
  const url = `https://genius.com${path}`
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })
  const $ = cheerio.load(res.data)
  const annotations: Array<{ fragment: string; body: string }> = []
  $('[data-id]').each((_, el) => {
    const fragment = $(el).text().trim()
    if (fragment && fragment.length > 0) {
      annotations.push({ fragment, body: '' })
    }
  })
  return annotations
}

export function buildReleaseDate(components?: { year?: number; month?: number; day?: number }): string | undefined {
  if (!components) return undefined
  const { year, month, day } = components
  if (!year) return undefined
  if (month && day) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (month) return `${year}-${String(month).padStart(2, '0')}-01`
  return `${year}-01-01`
}
