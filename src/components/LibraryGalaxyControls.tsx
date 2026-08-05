'use client'

/**
 * Left sidebar for the library-wide Galaxy default view — visually the same
 * 212px instrument-panel column as VizControls.tsx (Overlays / Filters /
 * Focus), rebuilt as its own small component rather than by editing
 * VizControls, since that component's props are shaped around the
 * per-artist page's VizFilters/FocusInfo and this screen's overlay/filter
 * set differs (no per-album decade axis at 'artists' granularity, an extra
 * granularity switch, an honest note about what's out of scope here).
 */

import type { FocusInfo } from '@/components/VizControls'
import type { Granularity } from '@/components/LibraryGalaxy'

export type { FocusInfo }

interface OverlayCount {
  collaborator: number
  producer: number
  era?: number
}

interface LibraryGalaxyControlsProps {
  granularity: Granularity
  showCollaborator: boolean
  showProducer: boolean
  showEra: boolean
  onToggle: (key: 'showCollaborator' | 'showProducer' | 'showEra') => void
  edgeCounts: OverlayCount
  decades: string[]
  decadeFilter: string
  onDecadeChange: (d: string) => void
  zoom: number
  focus: FocusInfo | null
  /** Present (and shown) only when the songs endpoint had to cap the node
   *  set below the library's real total — see /api/visualize/galaxy/songs. */
  songCap?: { shown: number; total: number }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[13px] py-3">
      <p className="m-0 mb-2.5 text-[9px] uppercase tracking-[.2em] text-text-ghost">{title}</p>
      {children}
    </div>
  )
}

export default function LibraryGalaxyControls({
  granularity, showCollaborator, showProducer, showEra, onToggle,
  edgeCounts, decades, decadeFilter, onDecadeChange, zoom, focus, songCap,
}: LibraryGalaxyControlsProps) {
  const zoomPct = Math.round(zoom * 100)
  const zoomBarPct = Math.max(0, Math.min(100, ((zoom - 0.2) / (4 - 0.2)) * 100))

  const overlays: { key: 'showCollaborator' | 'showProducer' | 'showEra'; label: string; color: string; on: boolean; count: number; hidden?: boolean }[] = [
    { key: 'showCollaborator', label: 'Collaborator', color: '#a78bfa', on: showCollaborator, count: edgeCounts.collaborator },
    { key: 'showProducer', label: 'Producer', color: '#38bdf8', on: showProducer, count: edgeCounts.producer },
    { key: 'showEra', label: 'Era ±2 yr', color: '#f472b6', on: showEra, count: edgeCounts.era ?? 0, hidden: granularity === 'artists' },
  ]

  return (
    <div className="w-[212px] shrink-0 flex flex-col gap-3">
      <Panel title="Overlays">
        <div className="flex flex-col">
          {overlays.filter(o => !o.hidden).map(o => (
            <div
              key={o.key}
              onClick={() => onToggle(o.key)}
              className="flex items-center gap-2 py-1 cursor-pointer group"
            >
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ background: o.on ? o.color : '#27272a', boxShadow: o.on ? `0 0 9px ${o.color}` : 'none' }}
              />
              <span className="flex-1 text-[10.5px] text-text-secondary group-hover:text-text-primary transition-colors">
                {o.label}
              </span>
              <span className="text-[9.5px] text-text-ghost">{o.count.toLocaleString()} edges</span>
            </div>
          ))}
          {granularity === 'artists' && (
            <p className="mt-1.5 mb-0 text-[9.5px] leading-[1.6] text-text-ghost">
              No era overlay at artist scale — see focus note below.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Filters">
        <div className="flex flex-col gap-3">
          {granularity === 'songs' ? (
            <div>
              <p className="m-0 mb-1 text-[10px] text-text-ghost">Decade</p>
              <div className="flex flex-wrap gap-1">
                {['All', ...decades].map(d => {
                  const value = d === 'All' ? 'all' : d
                  const active = decadeFilter === value
                  return (
                    <button
                      key={d}
                      onClick={() => onDecadeChange(value)}
                      className="rounded-[20px] px-2 py-0.5 text-[9.5px] transition-colors"
                      style={{
                        border: `1px solid ${active ? '#7c3aed' : '#27272a'}`,
                        background: active ? 'rgba(109,40,217,.28)' : '#18181b',
                        color: active ? '#c4b5fd' : '#a1a1aa',
                      }}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="m-0 text-[10px] text-text-ghost">
              Decade filtering is per-song only — switch to All Songs below.
            </p>
          )}

          {songCap && songCap.total > songCap.shown && (
            <p className="m-0 text-[9.5px] leading-[1.6] text-text-ghost">
              Showing the {songCap.shown.toLocaleString()} most-played songs of {songCap.total.toLocaleString()} indexed — zoom into an artist for the full picture.
            </p>
          )}

          <div>
            <p className="m-0 mb-1.5 text-[10px] text-text-ghost">Zoom {zoomPct}%</p>
            <div className="relative h-1 rounded-full bg-border">
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full bg-accent-dim"
                style={{ width: `${zoomBarPct}%`, boxShadow: '0 0 10px rgba(124,58,237,.8)' }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-full bg-accent-bright"
                style={{ left: `calc(${zoomBarPct}% - 5.5px)`, boxShadow: '0 0 10px rgba(196,181,253,.9)' }}
              />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Focus">
        {focus ? (
          <>
            <p className="m-0 mb-1 text-[11.5px] text-text-primary truncate">{focus.title}</p>
            <p className="m-0 mb-2 text-[10px] text-text-faint">{focus.subtitle}</p>
            <div className="flex flex-col gap-[3px]">
              {focus.rows.map(r => (
                <div key={r.k} className="flex justify-between gap-2 text-[10px]">
                  <span className="text-text-muted">{r.k}</span>
                  <span className="text-text-secondary truncate">{r.v}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="m-0 text-[10.5px] text-text-faint">
            {granularity === 'artists'
              ? 'Nothing selected. Double-click an artist to open its own galaxy.'
              : 'Nothing selected. Double-click a song to open it.'}
          </p>
        )}
        <p className="mt-2.5 mb-0 text-[9.5px] leading-[1.6] text-text-ghost">
          Timeline &amp; Swim-lanes are per-artist views (they lay out one artist&apos;s own release history) — open an artist to use them.
        </p>
      </Panel>
    </div>
  )
}
