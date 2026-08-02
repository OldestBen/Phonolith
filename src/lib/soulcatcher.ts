import axios from 'axios'

const SLSKD_URL = process.env.SLSKD_URL || 'http://slskd:5030'
const SLSKD_API_KEY = process.env.SLSKD_API_KEY || ''

function authHeaders(): Record<string, string> {
  return SLSKD_API_KEY ? { 'X-API-Key': SLSKD_API_KEY } : {}
}

const client = axios.create({
  baseURL: SLSKD_URL,
  timeout: 8000,
})

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SoulseekFile {
  username: string
  filename: string
  size: number
  bitRate?: number
  length?: number
  sampleRate?: number
  bitDepth?: number
  extension?: string
  /**
   * These three are reported by slskd at the *response* (peer) level, not
   * per-file — every file in the same peer's response shares the same
   * hasFreeUploadSlot/queueLength/uploadSpeed. We copy them onto each file
   * here so the results table can render one row per file without the UI
   * needing to know about slskd's response/file nesting.
   */
  hasFreeUploadSlot?: boolean
  queueLength?: number
  uploadSpeed?: number
}

interface SlskdSearchResponse {
  id: string
  state: string
  responses?: {
    username: string
    hasFreeUploadSlot?: boolean
    uploadSpeed?: number
    queueLength?: number
    files?: {
      filename: string
      size: number
      bitRate?: number
      length?: number
      sampleRate?: number
      bitDepth?: number
    }[]
  }[]
}

export interface SlskdTransfer {
  username: string
  filename: string
  size: number
  state: string
  bytesTransferred?: number
}

export interface SlskdStatus {
  online: boolean
  version?: string
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Start a Soulseek search via slskd and poll until it completes or ~10s elapses,
 * then return the aggregated file list across all peer responses. Never throws —
 * on any failure (slskd offline, search error, etc.) returns an empty array so
 * callers can treat "no results" and "offline" uniformly, falling back to
 * getSlskdStatus() if they need to distinguish the two.
 */
export async function searchSoulseek(query: string): Promise<SoulseekFile[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  try {
    const startRes = await client.post(
      '/api/v0/searches',
      { searchText: trimmed },
      { headers: authHeaders() }
    )
    const searchId: string | undefined = startRes.data?.id

    if (!searchId) return []

    const deadline = Date.now() + 10000
    let lastState = ''

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 750))

      const pollRes = await client.get<SlskdSearchResponse>(
        `/api/v0/searches/${searchId}`,
        { headers: authHeaders() }
      )
      lastState = pollRes.data?.state ?? ''

      if (lastState && lastState.toLowerCase().includes('completed')) {
        return aggregateResults(pollRes.data)
      }
    }

    // Timed out — fetch whatever results have accumulated so far rather than
    // returning nothing.
    const finalRes = await client.get<SlskdSearchResponse>(
      `/api/v0/searches/${searchId}`,
      { headers: authHeaders() }
    )
    return aggregateResults(finalRes.data)
  } catch {
    return []
  }
}

function aggregateResults(data: SlskdSearchResponse | undefined): SoulseekFile[] {
  if (!data?.responses) return []

  const files: SoulseekFile[] = []
  for (const response of data.responses) {
    if (!response.files) continue
    for (const file of response.files) {
      files.push({
        username: response.username,
        filename: file.filename,
        size: file.size,
        bitRate: file.bitRate,
        length: file.length,
        sampleRate: file.sampleRate,
        bitDepth: file.bitDepth,
        extension: file.filename.split('.').pop()?.toLowerCase(),
        hasFreeUploadSlot: response.hasFreeUploadSlot,
        queueLength: response.queueLength,
        uploadSpeed: response.uploadSpeed,
      })
    }
  }
  return files
}

// ── Downloads ─────────────────────────────────────────────────────────────────

/**
 * Enqueue a download from a given peer via slskd. Returns true on success,
 * false on any failure (slskd offline, peer unreachable, etc.) — callers
 * should surface a clear error rather than letting this throw.
 */
export async function downloadFile(username: string, filename: string, size: number): Promise<boolean> {
  try {
    await client.post(
      `/api/v0/transfers/downloads/${encodeURIComponent(username)}`,
      [{ filename, size }],
      { headers: authHeaders() }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Returns all in-flight/recent downloads as tracked by slskd itself, flattened
 * from slskd's per-user/per-directory grouping into a flat list of transfers.
 * Returns an empty array if slskd is unreachable.
 */
export async function getDownloadStatus(): Promise<SlskdTransfer[]> {
  try {
    const res = await client.get('/api/v0/transfers/downloads', { headers: authHeaders() })
    const data = res.data

    // slskd nests downloads as [{ username, directories: [{ files: [...] }] }]
    const transfers: SlskdTransfer[] = []
    if (Array.isArray(data)) {
      for (const userEntry of data) {
        const username = userEntry?.username
        const directories = userEntry?.directories ?? []
        for (const dir of directories) {
          const files = dir?.files ?? []
          for (const file of files) {
            transfers.push({
              username,
              filename: file.filename,
              size: file.size,
              state: file.state ?? 'Unknown',
              bytesTransferred: file.bytesTransferred,
            })
          }
        }
      }
    }
    return transfers
  } catch {
    return []
  }
}

/** Lightweight connectivity check used by the status route and UI. */
export async function getSlskdStatus(): Promise<SlskdStatus> {
  try {
    const res = await client.get('/api/v0/application', { headers: authHeaders() })
    return { online: true, version: res.data?.version }
  } catch {
    return { online: false }
  }
}
