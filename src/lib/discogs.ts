const DISCOGS_BASE = 'https://api.discogs.com'

function discogsHeaders() {
  const app = process.env.MUSICBRAINZ_APP_NAME || 'Phonolith'
  const version = process.env.MUSICBRAINZ_APP_VERSION || '1.0'
  const contact = process.env.MUSICBRAINZ_CONTACT || 'user@example.com'
  return {
    'User-Agent': `${app}/${version} ( ${contact} )`,
    'Authorization': `Discogs token=${process.env.DISCOGS_USER_TOKEN ?? ''}`,
    'Accept': 'application/json',
  }
}

export interface DiscogsRelease {
  id: number
  title: string
  year?: number
  country?: string
  format?: string[]
  label?: string[]
  catno?: string
  thumb?: string
}

export interface DiscogsReleaseDetail {
  id: number
  title: string
  country?: string
  released?: string
  labels?: Array<{ name: string; catno: string }>
  formats?: Array<{ name: string; qty?: string; descriptions?: string[] }>
  identifiers?: Array<{ type: string; value: string; description?: string }>
}

export async function searchRelease(artist: string, title: string, year?: string): Promise<DiscogsRelease[] | null> {
  try {
    const params = new URLSearchParams({
      type: 'release',
      artist,
      release_title: title,
      token: process.env.DISCOGS_USER_TOKEN ?? '',
    })
    if (year) params.set('year', year)

    const res = await fetch(`${DISCOGS_BASE}/database/search?${params.toString()}`, {
      headers: discogsHeaders(),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.results as DiscogsRelease[]) ?? []
  } catch {
    return null
  }
}

export async function getRelease(id: number): Promise<DiscogsReleaseDetail | null> {
  try {
    const res = await fetch(`${DISCOGS_BASE}/releases/${id}`, {
      headers: discogsHeaders(),
    })
    if (!res.ok) return null
    return (await res.json()) as DiscogsReleaseDetail
  } catch {
    return null
  }
}
