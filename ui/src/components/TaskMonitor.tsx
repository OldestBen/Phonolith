import { useState, useEffect, useRef } from 'react'
import { Activity, X, ChevronDown, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react'
import clsx from 'clsx'

export interface TaskEvent {
  id: string
  service: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  ts: string
}

const MAX_EVENTS = 100

const LEVEL_ICON: Record<string, React.FC<{ className?: string }>> = {
  info:    Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error:   XCircle,
}

const LEVEL_COLOR: Record<string, string> = {
  info:    'text-zinc-400',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error:   'text-red-400',
}

const SERVICE_LABEL: Record<string, string> = {
  lastfm:  'Last.fm',
  plex:    'Plex',
  tremor:  'Scanner',
  echograph: 'EchoGraph',
  aegis:   'Vault',
}

function fmtTs(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

interface Props {
  events: TaskEvent[]
  onClear: () => void
}

export default function TaskMonitor({ events, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [prevCount, setPrevCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const newCount = events.length - prevCount

  useEffect(() => {
    if (events.length > prevCount) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 800)
      return () => clearTimeout(t)
    }
  }, [events.length, prevCount])

  useEffect(() => {
    if (open) {
      setPrevCount(events.length)
      // scroll to bottom
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      }
    }
  }, [open, events.length])

  // badge: unseen events while closed
  const unseen = open ? 0 : newCount > 0 ? events.length - prevCount : 0

  const lastEvent = events[events.length - 1]

  return (
    <div className="fixed top-3 right-3 z-50 flex flex-col items-end gap-1">
      {/* Toggle button */}
      <button
        onClick={() => {
          setOpen(o => !o)
          if (!open) setPrevCount(events.length)
        }}
        className={clsx(
          'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium shadow-lg transition-all',
          flash
            ? 'border-violet-500/60 bg-violet-900/40 text-violet-300'
            : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
        )}
      >
        <Activity className="w-3.5 h-3.5" />
        <span>Task Log</span>
        {unseen > 0 && (
          <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
            {unseen}
          </span>
        )}
        <ChevronDown className={clsx('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Panel */}
      {open && (
        <div className="w-96 rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-300">Activity Log</span>
            <div className="flex items-center gap-2">
              {events.length > 0 && (
                <button
                  onClick={onClear}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Clear
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-zinc-600 hover:text-zinc-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Events list */}
          <div ref={listRef} className="flex flex-col overflow-y-auto max-h-80 min-h-[4rem]">
            {events.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-xs text-zinc-600">
                No activity yet
              </div>
            ) : (
              events.map(ev => {
                const Icon = LEVEL_ICON[ev.level] ?? Info
                return (
                  <div
                    key={ev.id}
                    className="flex items-start gap-2.5 px-3 py-2 border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/60"
                  >
                    <Icon className={clsx('w-3.5 h-3.5 flex-shrink-0 mt-0.5', LEVEL_COLOR[ev.level] ?? 'text-zinc-400')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                          {SERVICE_LABEL[ev.service] ?? ev.service}
                        </span>
                        <span className="text-[10px] text-zinc-700 font-mono flex-shrink-0">{fmtTs(ev.ts)}</span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-snug mt-0.5 break-words">{ev.message}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Latest event preview at bottom when events exist */}
          {events.length > 0 && lastEvent && (
            <div className="px-3 py-1.5 border-t border-zinc-800 bg-zinc-900/40">
              <p className="text-[10px] text-zinc-600 truncate">
                Latest: {lastEvent.message}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
