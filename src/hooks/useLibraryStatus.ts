'use client'

import { useEffect, useState } from 'react'

export interface ScanProgress {
  phase: 'idle' | 'discovering' | 'indexing'
  total: number
  done: number
  current_file: string | null
  errors: string[]
  source_name: string | null
}

export interface LibraryStatus {
  scanning: boolean
  files_indexed: number
  last_scan: string | null
  watching: boolean
  online: boolean
  scan_progress: ScanProgress
}

/**
 * Polls /api/library/status on a single shared interval. Both the header's
 * live track-count readout and the Notifications bell need this data — a
 * shared hook means one poll instead of two independent ones drifting out
 * of sync with each other.
 */
export function useLibraryStatus(intervalMs = 2000): LibraryStatus | null {
  const [status, setStatus] = useState<LibraryStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch('/api/library/status')
        if (r.ok && !cancelled) setStatus(await r.json())
      } catch {
        // transient — next poll will recover
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs])

  return status
}
