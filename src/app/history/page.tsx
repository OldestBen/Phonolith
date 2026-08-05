'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import type { HistoryEvent } from '@/lib/types'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'ghost' | 'completeness' | 'log'
type EventTypeFilter = 'all' | 'lyrics_read' | 'lyrics_download' | 'play'

interface StatsData {
  reads_per_week: Array<{ week: string; count: number }>
  top_artists: Array<{ artist_id: number; name: string; image_url: string | null; count: number }>
  total_events: number
  total_artists: number
  total_songs: number
}

interface GhostTrack {
  song_id: number
  title: string
  artist_name: string
  last_event: string | null
  days_since: number | null
  dr_score: number | null
}

interface CompletenessRow {
  artist_id: number
  name: string
  image_url: string | null
  total_songs: number
  library_songs: number
  pct: number
}

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

function formatWeekLabel(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
  } catch {
    return isoDate
  }
}

function EventBadge({ event }: { event: HistoryEvent['event'] }) {
  const styles: Record<string, string> = {
    lyrics_read: 'bg-accent/10 border-accent/20 text-accent',
    lyrics_download: 'bg-success/10 border-success/20 text-success',
    lyrics_marked_read: 'bg-accent/10 border-accent/20 text-accent',
    annotation_added: 'bg-accent/10 border-accent/20 text-accent',
    play: 'bg-warning/10 border-warning/20 text-warning',
  }
  const labels: Record<string, string> = {
    lyrics_read: 'Read',
    lyrics_download: 'Download',
    lyrics_marked_read: 'Marked read',
    annotation_added: 'Annotation',
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

// ── Custom recharts tooltip ────────────────────────────────────────────────────

interface WeekTooltipProps {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}

function WeekTooltip({ active, payload, label }: WeekTooltipProps) {
  if (!active || !payload?.length || !label) return null
  // label is the ISO week date (Mon of that week)
  let rangeLabel = label
  try {
    const start = new Date(label + 'T00:00:00Z')
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 6)
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    rangeLabel = `${fmt(start)} – ${fmt(end)}`
  } catch {}

  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-text-muted text-xs mb-1">{rangeLabel}</p>
      <p className="text-text-primary font-semibold">{payload[0].value} events</p>
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: StatsData | null }) {
  if (!data) {
    return (
      <div className="animate-pulse space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-2 rounded" />
        ))}
      </div>
    )
  }

  const weekData = data.reads_per_week.map(r => ({
    week: r.week,
    label: formatWeekLabel(r.week),
    count: r.count,
  }))

  const barData = data.top_artists.map(a => ({
    name: a.name.length > 18 ? a.name.slice(0, 16) + '…' : a.name,
    fullName: a.name,
    count: a.count,
    artist_id: a.artist_id,
  }))

  return (
    <div className="space-y-10">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Events', value: data.total_events },
          { label: 'Unique Songs', value: data.total_songs },
          { label: 'Unique Artists', value: data.total_artists },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface rounded-xl border border-border p-4 text-center">
            <p className="text-text-primary text-2xl font-bold font-mono">{value}</p>
            <p className="text-text-muted text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Reads per week */}
      <div>
        <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4 font-medium">
          Activity — Last 12 Weeks
        </h2>
        {weekData.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-8">No activity in the last 12 weeks.</p>
        ) : (
          <div className="w-full h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="accentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<WeekTooltip />} cursor={{ stroke: '#a78bfa', strokeWidth: 1, strokeDasharray: '4 2' }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="url(#accentGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#a78bfa', stroke: '#1a1a1e', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top artists bar chart */}
      {barData.length > 0 && (
        <div>
          <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4 font-medium">
            Top Artists — Last 90 Days
          </h2>
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ top: 0, right: 8, bottom: 0, left: 8 }}
              >
                <XAxis
                  type="number"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(167,139,250,0.06)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as typeof barData[0]
                    return (
                      <div className="bg-surface border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
                        <p className="text-text-primary font-medium">{d.fullName}</p>
                        <p className="text-text-muted text-xs">{d.count} events</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {barData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill="#a78bfa" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Ghost Report tab ──────────────────────────────────────────────────────────

function GhostTab({ data }: { data: GhostTrack[] | null }) {
  if (!data) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-surface-2 rounded" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <p className="text-text-muted text-sm text-center py-16">
        No ghost tracks — your library is well-explored.
      </p>
    )
  }

  return (
    <div>
      <p className="text-text-muted text-xs mb-4">
        Songs in your library that haven&apos;t been touched in over a year (or never).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="text-text-muted text-xs uppercase tracking-wide font-medium pb-2 pr-4">Track</th>
              <th className="text-text-muted text-xs uppercase tracking-wide font-medium pb-2 pr-4">Artist</th>
              <th className="text-text-muted text-xs uppercase tracking-wide font-medium pb-2 pr-4">Last Played</th>
              <th className="text-text-muted text-xs uppercase tracking-wide font-medium pb-2 pr-4">Days Since</th>
              <th className="text-text-muted text-xs uppercase tracking-wide font-medium pb-2 text-right">DR</th>
            </tr>
          </thead>
          <tbody>
            {data.map(track => (
              <tr
                key={track.song_id}
                className="border-b border-border/50 hover:bg-surface-2 transition-colors"
              >
                <td className="py-2.5 pr-4">
                  <Link
                    href={`/song/${track.song_id}`}
                    className="text-text-primary hover:text-accent transition-colors truncate block max-w-[200px]"
                  >
                    {track.title}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-text-muted">{track.artist_name}</td>
                <td className="py-2.5 pr-4">
                  {track.last_event == null ? (
                    <span className="text-warning text-xs font-medium">Never</span>
                  ) : (
                    <span className="text-text-muted text-xs">
                      {new Date(track.last_event).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4">
                  {track.days_since != null ? (
                    <span className="text-danger text-xs font-medium">{track.days_since}d</span>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  {track.dr_score != null ? (
                    <span className="text-text-muted text-xs font-mono">{track.dr_score}</span>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Completeness tab ──────────────────────────────────────────────────────────

function CompletenessTab({ data }: { data: CompletenessRow[] | null }) {
  if (!data) {
    return (
      <div className="animate-pulse space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-2 rounded" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <p className="text-text-muted text-sm text-center py-16">
        No completeness data yet — start exploring your library to see coverage stats.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-text-muted text-xs">
        Library coverage vs. known discography for artists in your history.
      </p>
      {data.map(row => {
        const barColor =
          row.pct >= 75 ? '#22c55e' : row.pct >= 25 ? '#f59e0b' : '#ef4444'

        return (
          <div key={row.artist_id}>
            <div className="flex items-center justify-between mb-1.5">
              <Link
                href={`/artist/${row.artist_id}`}
                className="text-text-primary text-sm hover:text-accent transition-colors font-medium"
              >
                {row.name}
              </Link>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>{row.library_songs} / {row.total_songs}</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: barColor }}
                >
                  {row.pct}%
                </span>
              </div>
            </div>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${row.pct}%`, backgroundColor: barColor }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Log tab ───────────────────────────────────────────────────────────────────

function LogTab({
  events,
  loading,
}: {
  events: HistoryEvent[]
  loading: boolean
}) {
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>('all')

  const filteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events
    return events.filter(e => e.event === typeFilter)
  }, [events, typeFilter])

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-surface-2 rounded" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-muted text-xs uppercase tracking-widest font-medium">Event Log</h2>
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
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('overview')

  // Track which tabs have been loaded
  const loaded = useRef<Set<Tab>>(new Set())

  // Overview stats
  const [statsData, setStatsData] = useState<StatsData | null>(null)

  // Ghost tracks
  const [ghostData, setGhostData] = useState<GhostTrack[] | null>(null)

  // Completeness
  const [completenessData, setCompletenessData] = useState<CompletenessRow[] | null>(null)

  // Log
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [logLoading, setLogLoading] = useState(false)

  // Lazy-load per tab
  useEffect(() => {
    if (loaded.current.has(tab)) return
    loaded.current.add(tab)

    if (tab === 'overview') {
      fetch('/api/history/stats')
        .then(r => r.ok ? r.json() : null)
        .then((data: StatsData | null) => setStatsData(data))
        .catch(() => setStatsData({ reads_per_week: [], top_artists: [], total_events: 0, total_artists: 0, total_songs: 0 }))
    }

    if (tab === 'ghost') {
      fetch('/api/history/ghost')
        .then(r => r.ok ? r.json() : [])
        .then((data: GhostTrack[]) => setGhostData(data))
        .catch(() => setGhostData([]))
    }

    if (tab === 'completeness') {
      fetch('/api/history/completeness')
        .then(r => r.ok ? r.json() : [])
        .then((data: CompletenessRow[]) => setCompletenessData(data))
        .catch(() => setCompletenessData([]))
    }

    if (tab === 'log') {
      setLogLoading(true)
      fetch('/api/history?limit=200')
        .then(r => r.ok ? r.json() : { events: [] })
        .then(data => setEvents(data.events ?? data ?? []))
        .catch(() => setEvents([]))
        .finally(() => setLogLoading(false))
    }
  }, [tab])

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'ghost', label: 'Ghost Report' },
    { key: 'completeness', label: 'Completeness' },
    { key: 'log', label: 'Log' },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-6">History</h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-8 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
              ${tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab data={statsData} />}
      {tab === 'ghost' && <GhostTab data={ghostData} />}
      {tab === 'completeness' && <CompletenessTab data={completenessData} />}
      {tab === 'log' && <LogTab events={events} loading={logLoading} />}
    </div>
  )
}
