'use client'

import type { QueueState } from '@/hooks/useAnalysisQueue'

export default function BulkActionBar({
  count,
  queueState,
  queued,
  failed,
  onQueue,
  onClear,
}: {
  count: number
  queueState: QueueState
  queued: number
  failed: number
  onQueue: () => void
  onClear: () => void
}) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-16 md:bottom-4 left-1/2 md:left-[calc(50%+7rem)] -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border border-accent-dim/40 bg-surface px-4 py-2 shadow-[0_8px_24px_rgba(0,0,0,.5)]">
      <span className="text-xs text-text-primary font-medium">
        {count} selected
      </span>
      {queueState === 'idle' && (
        <>
          <button
            onClick={onQueue}
            className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/80 transition-colors"
          >
            Queue analysis
          </button>
          <button
            onClick={onClear}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Clear
          </button>
        </>
      )}
      {queueState === 'queuing' && (
        <span className="text-xs text-text-muted">Queuing… {queued + failed}/{count}</span>
      )}
      {queueState === 'done' && (
        <>
          <span className="text-xs text-success">
            Queued {queued}{failed > 0 ? `, ${failed} failed` : ''}
          </span>
          <button
            onClick={onClear}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}
