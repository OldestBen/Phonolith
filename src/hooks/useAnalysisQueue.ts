'use client'

import { useCallback, useState } from 'react'

export type QueueState = 'idle' | 'queuing' | 'done'

/**
 * Selection + bulk "queue deep analysis" state, shared by every surface that
 * lets you pick files and analyze them on demand (Albums grid, Album view,
 * Songs tab, Files tab).
 *
 * There's no bespoke "bulk analyze" backend endpoint — this just calls the
 * real existing per-file trigger (`POST /api/library/{hash}/deep-scan`,
 * already used by the single-file "Deep scan" action on the file detail
 * page) once per selected hash, with limited concurrency so a large
 * selection doesn't slam the analyst sidecar with hundreds of simultaneous
 * requests.
 */
export function useAnalysisQueue() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [queueState, setQueueState] = useState<QueueState>('idle')
  const [queued, setQueued] = useState(0)
  const [failed, setFailed] = useState(0)

  const toggle = useCallback((hash: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }, [])

  const toggleMany = useCallback((hashes: string[], on?: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      const shouldAdd = on ?? !hashes.every(h => next.has(h))
      for (const h of hashes) {
        if (shouldAdd) next.add(h)
        else next.delete(h)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  const queueAnalysis = useCallback(async () => {
    const hashes = Array.from(selected)
    if (hashes.length === 0) return
    setQueueState('queuing')
    setQueued(0)
    setFailed(0)

    const CONCURRENCY = 4
    let ok = 0
    let err = 0
    let i = 0
    async function worker() {
      while (i < hashes.length) {
        const hash = hashes[i++]
        try {
          const r = await fetch(`/api/library/${hash}/deep-scan`, { method: 'POST' })
          const data = await r.json().catch(() => null)
          if (data?.ok !== false) ok++
          else err++
        } catch {
          err++
        }
        setQueued(ok)
        setFailed(err)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hashes.length) }, worker))
    setQueueState('done')
  }, [selected])

  return { selected, toggle, toggleMany, clear, queueAnalysis, queueState, queued, failed, total: selected.size }
}
