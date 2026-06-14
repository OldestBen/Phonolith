'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import type { HistoryEvent } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function EventBadge({ event }: { event: HistoryEvent['event'] }) {
  const styles: Record<string, string> = {
    lyrics_read: 'bg-accent/10 border-accent/20 text-accent',
    lyrics_download: 'bg-success/10 border-success/20 text-success',
    play: 'bg-warning/10 border-warning/20 text-warning',
  }
  const labels: Record<string, string> = {
    lyrics_read: 'Read',
    lyrics_download: 'Download',
    play: 'Play',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${
        styles[event] ?? 'bg-surface-2 border-border text-text-muted'
      }`}
    >
      {labels[event] ?? event}
    </span>
  )
}

// ── Top artist bar ────────────────────────────────────────────────────────────
function TopArtistBar({ name, count, max, artistId }: {
  name: string
  count: number
  max: number
  artistId?: number
}) {
  const widthPct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="w-32 shrink-0 text-right">
        {artistId ? (
          <Link
            href={`/artist/${artistId}`}
            className="text-text-primary text-sm hover:text-accent transition-colors truncate block"
          >
            {name}
          </Link>
        ) : (
          <span className="text-text-primary text-sm truncate block">{name}</span>
        )}
      </div>
      <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden relative">
        <div
          className="h-full bg-accent/60 rounded-full transition-all duration-500"
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="text-text-muted text-xs w-8 text-right shrink-0">{count}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
type EventTypeFilter = 'all' | 'lyrics_read' | 'lyrics_download' | 'play'

export default function HistoryPage() {
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>('all')

  useEffect(() => {
    setLoading(true)
    fetch('/api/history?limit=200')
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])

  // Summary stats
  const stats = useMemo(() => {
    const uniqueSongs = new Set(events.map(e => e.song_id).filter(Boolean)).size
    const uniqueArtists = new Set(events.map(e => e.artist_id).filter(Boolean)).size
    return { total: events.length, uniqueSongs, uniqueArtists }
  }, [events])

  // Top artists
  const topArtists = useMemo(() => {
    const counts = new Map<string, { count: number; id?: number }>()
    for (const e of events) {
      if (!e.artist_name) continue
      const existing = counts.get(e.artist_name)
      if (existing) {
        existing.count++
      } else {
        counts.set(e.artist_name, { count: 1, id: e.artist_id })
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, { count, id }]) => ({ name, count, id }))
  }, [events])

  const maxCount = topArtists[0]?.count ?? 1

  // Filtered events for log
  const filteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events
    return events.filter(e => e.event === typeFilter)
  }, [events, typeFilter])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-8">History</h1>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 bg-surface-2 rounded" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: 'Total Events', value: stats.total },
              { label: 'Unique Songs', value: stats.uniqueSongs },
              { label: 'Unique Artists', value: stats.uniqueArtists },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface rounded-xl border border-border p-4 text-center">
                <p className="text-text-primary text-2xl font-bold font-mono">{value}</p>
                <p className="text-text-muted text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Top artists */}
          {topArtists.length > 0 && (
            <div className="mb-10">
              <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4 font-medium">
                Top Artists
              </h2>
              {topArtists.map(a => (
                <TopArtistBar
                  key={a.name}
                  name={a.name}
                  count={a.count}
                  max={maxCount}
                  artistId={a.id}
                />
              ))}
            </div>
          )}

          {/* Event log */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-text-muted text-xs uppercase tracking-widest font-medium">
                Event Log
              </h2>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as EventTypeFilter)}
                className="bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-1.5
                           focus:outline-none focus:border-accent"
              >
                <option value="all">All events</option>
                <option value="lyrics_read">Lyrics read</option>
                <option value="lyrics_download">Lyrics download</option>
                <option value="play">Play</option>
              </select>
            </div>

            {filteredEvents.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-12">No events recorded yet.</p>
            ) : (
              <div className="space-y-0">
                {filteredEvents.map(event => (
                  <div
                    key={event.id}
                    className="flex items-center gap-4 py-2.5 border-b border-border/50
                               hover:bg-surface-2 rounded px-2 transition-colors"
                  >
                    <span className="text-text-muted text-xs shrink-0 w-36">
                      {formatDateTime(event.created_at)}
                    </span>
                    <EventBadge event={event.event} />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {event.song_id && event.song_title ? (
                        <Link
                          href={`/song/${event.song_id}`}
                          className="text-text-primary text-sm hover:text-accent transition-colors truncate"
                        >
                          {event.song_title}
                        </Link>
                      ) : (
                        <span className="text-text-muted text-sm truncate">—</span>
                      )}
                      {event.artist_name && (
                        <>
                          <span className="text-text-muted text-xs shrink-0">by</span>
                          {event.artist_id ? (
                            <Link
                              href={`/artist/${event.artist_id}`}
                              className="text-text-muted text-sm hover:text-accent transition-colors truncate"
                            >
                              {event.artist_name}
                            </Link>
                          ) : (
                            <span className="text-text-muted text-sm truncate">{event.artist_name}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
