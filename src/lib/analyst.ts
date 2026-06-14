import axios from 'axios'

const ANALYST_URL = process.env.ANALYST_URL || 'http://localhost:8000'

export interface AnalystStatus {
  files_indexed: number
  last_scan: string | null
  watching: boolean
}

export interface AnalystFile {
  blake3_hash: string
  file_path: string
  format?: string
  bitrate?: number
  sample_rate?: number
  bit_depth?: number
  duration_ms?: number
  dr_score?: number
  spectral_ok?: boolean
  waveform_path?: string
  fingerprint?: string
}

export async function getStatus(): Promise<AnalystStatus | null> {
  try {
    const res = await axios.get(`${ANALYST_URL}/status`, { timeout: 5000 })
    return res.data as AnalystStatus
  } catch {
    return null
  }
}

export async function triggerScan(libraryPath?: string): Promise<void> {
  await axios.post(`${ANALYST_URL}/scan`, { path: libraryPath || '/music' }, { timeout: 10000 })
}

export async function getFile(hash: string): Promise<AnalystFile | null> {
  try {
    const res = await axios.get(`${ANALYST_URL}/file/${hash}`, { timeout: 5000 })
    return res.data as AnalystFile
  } catch {
    return null
  }
}

export async function getFingerprint(filePath: string): Promise<string | null> {
  try {
    const res = await axios.post(`${ANALYST_URL}/fingerprint`, { path: filePath }, { timeout: 30000 })
    return res.data.fingerprint as string
  } catch {
    return null
  }
}
