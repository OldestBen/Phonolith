'use client'

import { useState, useEffect, useRef } from 'react'

interface ScanProgress {
  phase: 'idle' | 'discovering' | 'indexing'
  total: number
  done: number
  current_file: string | null
  errors: string[]
  source_name: string | null
}

interface LibStatus {
  scanning: boolean
  files_indexed: number
  last_scan: string | null
  watching: boolean
  online: boolean
  scan_progress: ScanProgress
}

export default function Notifications() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LibStatus | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/library/status')
        if (r.ok) setStatus(await r.json())
      } catch {}
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const scanning = status?.scanning ?? false
  const progress = status?.scan_progress
  const phase = progress?.phase ?? 'idle'
  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        className="relative w-8 h-8 rounded-lg flex items-center justify-center bg-surface border border-border hover:border-accent/40 transition-colors"
      >
        <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {scanning && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
        )}
      </button>

      {open && (
        <div className="absolute top-10 right-0 w-80 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-text-primary text-sm font-semibold">Notifications</span>
            {scanning && (
              <span className="text-accent text-xs font-medium animate-pulse">Scanning…</span>
            )}
          </div>

          <div className="p-3 max-h-96 overflow-y-auto space-y-2">
            {scanning && progress ? (
              <div className="bg-surface-2 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-text-primary text-xs font-medium truncate pr-2">
                    {progress.source_name ? `Scanning ${progress.source_name}` : 'Library scan in progress'}
                  </span>
                  {phase === 'indexing' && (
                    <span className="text-accent text-xs font-mono shrink-0">{pct}%</span>
                  )}
                </div>

                {phase === 'discovering' ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                        <div className="h-full bg-accent/40 rounded-full animate-pulse w-full" />
                      </div>
                    </div>
                    <p className="text-text-muted text-[11px]">
                      Discovering files… {progress.done.toLocaleString()} found
                    </p>
                    {progress.current_file && (
                      <p className="text-text-muted text-[10px] font-mono truncate">
                        {progress.current_file.split(/[/\\]/).pop()}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-text-muted text-[11px]">
                      <span>{progress.done.toLocaleString()} / {progress.total.toLocaleString()} files</span>
                      {progress.errors.length > 0 && (
                        <span className="text-warning">{progress.errors.length} error{progress.errors.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    {progress.current_file && (
                      <p className="text-text-muted text-[10px] font-mono truncate">
                        {progress.current_file.split(/[/\\]/).pop()}
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : status?.last_scan ? (
              <div className="bg-surface-2 rounded-lg p-3">
                <p className="text-text-primary text-xs font-medium">Last scan complete</p>
                <p className="text-text-muted text-[11px] mt-0.5">
                  {new Date(status.last_scan).toLocaleString()} · {(status.files_indexed ?? 0).toLocaleString()} files indexed
                </p>
                {progress && progress.errors.length > 0 && (
                  <p className="text-warning text-[11px] mt-1">{progress.errors.length} file{progress.errors.length !== 1 ? 's' : ''} had errors</p>
                )}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-text-muted text-xs">No activity yet</p>
                <p className="text-text-muted text-[10px] mt-1">Trigger a scan from Settings → Library Sources</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
