'use client'

import type { HistoryEvent } from '@/lib/types'

interface HistoryChartProps {
  events: HistoryEvent[]
}

export default function HistoryChart({ events }: HistoryChartProps) {
  // Count events by artist
  const artistCounts = new Map<string, number>()
  for (const e of events) {
    if (e.artist_name) {
      artistCounts.set(e.artist_name, (artistCounts.get(e.artist_name) ?? 0) + 1)
    }
  }

  const topArtists = Array.from(artistCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const maxCount = topArtists[0]?.[1] ?? 1

  // Count events per week for the last 12 weeks
  const now = Date.now()
  const weeks: number[] = Array(12).fill(0)
  for (const e of events) {
    const age = now - new Date(e.created_at).getTime()
    const weekIdx = Math.floor(age / (7 * 24 * 60 * 60 * 1000))
    if (weekIdx < 12) weeks[11 - weekIdx]++
  }
  const maxWeek = Math.max(...weeks, 1)

  return (
    <div className="space-y-6">
      {/* Weekly trend */}
      <div>
        <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Lyrics reads (last 12 weeks)</h3>
        <div className="flex items-end gap-1 h-16">
          {weeks.map((count, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-accent/60 min-h-[2px] transition-all"
                style={{ height: `${Math.max(2, (count / maxWeek) * 100)}%` }}
                title={`${count} events`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-text-muted">12w ago</span>
          <span className="text-xs text-text-muted">This week</span>
        </div>
      </div>

      {/* Top artists */}
      {topArtists.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Top Artists</h3>
          <div className="space-y-2">
            {topArtists.map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-sm text-text-primary w-32 truncate flex-shrink-0">{name}</span>
                <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
