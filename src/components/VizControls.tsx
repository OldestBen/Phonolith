'use client'

/**
 * Left sidebar for the Galaxy screen — Overlays / Filters / Focus, matching
 * the Claude Design mockup's 212px instrument-panel column. Purely
 * presentational: all the state it reads (filters, edge counts, decades,
 * zoom, focus) is real data lifted out of ArtistViz/the page, not mocked.
 */

import type { VizFilters } from '@/components/ArtistViz'

export interface FocusInfo {
  title: string
  subtitle: string
  rows: { k: string; v: string }[]
}

interface VizControlsProps {
  filters: VizFilters
  onFiltersChange: (f: VizFilters) => void
  edgeCounts: { collaborator: number; producer: number; era: number }
  decades: string[]
  zoom: number
  focus: FocusInfo | null
}

const OVERLAYS: {
  key: 'showCollaborator' | 'showProducer' | 'showEra'
  label: string
  color: string
  countKey: 'collaborator' | 'producer' | 'era'
}[] = [
  { key: 'showCollaborator', label: 'Collaborator', color: '#60a5fa', countKey: 'collaborator' },
  { key: 'showProducer', label: 'Producer', color: '#f59e0b', countKey: 'producer' },
  { key: 'showEra', label: 'Era (±2yr)', color: '#34d399', countKey: 'era' },
]

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[13px] py-3">
      <p className="m-0 mb-2.5 text-[9px] uppercase tracking-[.2em] text-text-ghost">{title}</p>
      {children}
    </div>
  )
}

export default function VizControls({ filters, onFiltersChange, edgeCounts, decades, zoom, focus }: VizControlsProps) {
  const update = (patch: Partial<VizFilters>) => onFiltersChange({ ...filters, ...patch })

  const zoomPct = Math.round(zoom * 100)
  const zoomBarPct = Math.max(0, Math.min(100, ((zoom - 0.3) / (3 - 0.3)) * 100))

  return (
    <div className="w-[212px] shrink-0 flex flex-col gap-3">
      <Panel title="Overlays">
        <div className="flex flex-col">
          {OVERLAYS.map(o => {
            const on = filters[o.key]
            return (
              <div
                key={o.key}
                onClick={() => update({ [o.key]: !on } as Partial<VizFilters>)}
                className="flex items-center gap-2 py-1 cursor-pointer group"
              >
                <span
                  className="w-2 h-2 rounded-sm shrink-0 transition-opacity"
                  style={{ background: o.color, boxShadow: on ? `0 0 6px ${o.color}` : 'none', opacity: on ? 1 : 0.3 }}
                />
                <span className="flex-1 text-[10.5px] text-text-secondary group-hover:text-text-primary transition-colors">
                  {o.label}
                </span>
                <span className="text-[9.5px] text-text-ghost">{edgeCounts[o.countKey].toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Filters">
        <div className="flex flex-col gap-3">
          <div>
            <p className="m-0 mb-1 text-[10px] text-text-ghost">Decade</p>
            <div className="flex flex-wrap gap-1">
              {['All', ...decades].map(d => {
                const value = d === 'All' ? 'all' : d
                const active = filters.decadeFilter === value
                return (
                  <button
                    key={d}
                    onClick={() => update({ decadeFilter: value })}
                    className={`rounded-full border px-2 py-0.5 text-[9.5px] transition-colors ${
                      active
                        ? 'border-transparent bg-accent-dim text-white'
                        : 'border-border bg-surface text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          </div>

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
          <p className="m-0 text-[10.5px] text-text-faint">Nothing selected.</p>
        )}
        <p className="mt-2.5 mb-0 text-[9.5px] leading-[1.6] text-text-ghost">
          Click a node to select · double-click an album to focus · scroll to zoom · drag to pan · Esc to reset.
        </p>
      </Panel>
    </div>
  )
}
