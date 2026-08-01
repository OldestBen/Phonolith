'use client'

/**
 * Shared "instrument panel" primitives — ported 1:1 from the Claude Design
 * mockup (Phonolith.dc.html)'s generic screen renderer and its `card()`/
 * `field()`/`col()`/`cell()`/`seg()` helper functions. Every Phase 1 screen
 * (Sources, Cathode, Soulcatcher, Version Manager, Engineer Matrix, Settings,
 * etc.) is built from these rather than re-deriving the look per page, so a
 * change to the aesthetic only has to happen once.
 *
 * Exact pixel/color values below are transcribed from the mockup's inline
 * styles, not approximated — this is deliberate: the brief was to match the
 * design exactly, not "in the spirit of."
 */

import { type ReactNode, useEffect, useRef } from 'react'

// ── Palette (mirrors tailwind.config.ts; used where a raw value is needed —
//    canvas drawing, dynamic box-shadow colors — that Tailwind classes can't
//    express) ──────────────────────────────────────────────────────────────
export const C = {
  dim: '#a1a1aa',
  mut: '#71717a',
  faint: '#52525b',
  bright: '#f4f4f5',
  txt: '#d4d4d8',
  green: '#4ade80',
  yel: '#facc15',
  orange: '#fb923c',
  red: '#f87171',
  vio: '#a78bfa',
  amb: '#ffb340',
  V: '#7c3aed',
}

/** DR-score → color, matching the mockup's `drCol` exactly. */
export function drColor(dr: number): string {
  if (dr >= 14) return C.green
  if (dr >= 10) return '#a3e635'
  if (dr >= 8) return C.yel
  if (dr >= 5) return C.orange
  return C.red
}

/** A segmented (dashed) horizontal fill bar — mirrors the mockup's `seg()`. */
function segStyle(color: string, pct: number): React.CSSProperties {
  return {
    height: '100%',
    width: `${pct}%`,
    background: `repeating-linear-gradient(90deg, ${color} 0 4px, rgba(0,0,0,0) 4px 6px)`,
    filter: `drop-shadow(0 0 4px ${color}99)`,
  }
}

// ── Description ───────────────────────────────────────────────────────────

export function ScreenDesc({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[760px] text-[11px] leading-[1.7] text-text-faint" style={{ textWrap: 'pretty' as 'pretty' }}>
      {children}
    </p>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────

export function TabBar({
  tabs,
  active,
  onPick,
}: {
  tabs: string[]
  active: number
  onPick: (i: number) => void
}) {
  return (
    <div
      className="flex gap-1 w-fit rounded-lg border border-border p-1 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
      style={{ background: 'linear-gradient(180deg,#15151a,#0d0d10)' }}
    >
      {tabs.map((label, i) => (
        <button
          key={label}
          onClick={() => onPick(i)}
          className={`rounded-md px-3 py-1.5 text-[10.5px] font-medium transition-colors ${
            i === active ? 'text-white shadow-[0_0_14px_rgba(109,40,217,.45)]' : 'text-text-faint hover:text-text-muted'
          }`}
          style={i === active ? { background: '#6d28d9' } : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Canvas panel (bevelled box with a title overlay + a live <canvas>) ─────

export function CanvasPanel({
  title,
  subtitle,
  height = 240,
  background = '#0a0a0e',
  draw,
}: {
  title: string
  subtitle: string
  height?: number
  background?: string
  /** Called with the canvas 2D context + its (width, height) on mount, resize,
   * and every animation frame if it returns a cleanup/loop itself. */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const start = performance.now()
    const loop = (now: number) => {
      const rect = canvas.getBoundingClientRect()
      draw(ctx, rect.width, rect.height, (now - start) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="relative overflow-hidden rounded-[10px] border border-border"
      style={{ background, height }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[46px]"
        style={{ background: 'linear-gradient(180deg,rgba(8,8,10,.94) 0%,rgba(8,8,10,.7) 62%,rgba(8,8,10,0) 100%)' }}
      />
      <div className="pointer-events-none absolute left-[13px] top-[10px]">
        <p className="m-0 text-[9.5px] uppercase tracking-[.18em] text-text-muted">{title}</p>
        <p className="mt-0.5 text-[9px] text-text-ghost">{subtitle}</p>
      </div>
    </div>
  )
}

// ── Stat grid ─────────────────────────────────────────────────────────────

export function StatGrid({ stats }: { stats: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
      {stats.map(s => (
        <div
          key={s.label}
          className="rounded-lg border border-border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.06)]"
          style={{ background: 'linear-gradient(180deg,#15151a,#0d0d10)' }}
        >
          <p className="m-0 mb-1 text-[9px] uppercase tracking-[.16em] text-text-ghost">{s.label}</p>
          <p className="m-0 text-[17px] font-bold tracking-[.04em] text-amber [text-shadow:0_0_11px_rgba(255,179,64,.42)]">
            {s.value}
          </p>
          {s.sub && <p className="mt-0.5 text-[9.5px] text-text-ghost">{s.sub}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Fields panel (labeled read-only/editable boxes + optional action) ─────

export interface FieldSpec {
  label: string
  value: ReactNode
  mono?: boolean
}

export function FieldsPanel({
  title,
  fields,
  action,
  onAction,
}: {
  title: string
  fields: FieldSpec[]
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[15px] py-[13px]">
      <p className="m-0 mb-2.5 text-[9px] uppercase tracking-[.2em] text-text-ghost">{title}</p>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {fields.map(f => (
          <div key={f.label} className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-[.16em] text-text-ghost">{f.label}</label>
            <div
              className={`rounded-md border border-[#3f3f46] bg-[#0a0a0c] px-[9px] py-1.5 text-[11px] shadow-[inset_0_0_10px_rgba(0,0,0,.7)] ${
                f.mono ? 'text-amber' : 'text-text-secondary'
              }`}
            >
              {f.value}
            </div>
          </div>
        ))}
      </div>
      {action && (
        <button
          onClick={onAction}
          className="mt-3 rounded-md px-[13px] py-1.5 text-[10.5px] font-medium text-white shadow-[0_0_15px_rgba(109,40,217,.45)] hover:bg-accent-dim transition-colors"
          style={{ background: '#6d28d9' }}
        >
          {action}
        </button>
      )}
    </div>
  )
}

// ── Info card (the rich card: dot/title/sub/badge + optional pills/bar/rows/diff/actions/foot) ─

export interface CardSpec {
  title: string
  sub?: string
  badge?: string
  badgeColor?: string
  dot?: string
  accent?: boolean
  pills?: string[]
  bar?: number
  barColor?: string
  barLabel?: string
  rows?: [string, string, string?][]
  diffOld?: string
  diffNew?: string
  actions?: [string, boolean][] // [label, primary?]
  foot?: string
  onAction?: (label: string) => void
}

export function InfoCard({ card }: { card: CardSpec }) {
  const dot = card.dot || C.V
  return (
    <div
      className="rounded-[9px] border px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,.06),inset_0_-14px_24px_rgba(0,0,0,.35)]"
      style={{
        borderColor: card.accent ? 'rgba(124,58,237,.5)' : '#27272a',
        background: 'linear-gradient(180deg,#15151a,#0d0d10)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1 h-[7px] w-[7px] shrink-0 rounded-[2px]"
          style={{ background: dot, boxShadow: `0 0 8px ${dot}` }}
        />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold text-text-primary">{card.title}</p>
          {card.sub && <p className="mt-0.5 text-[10px] text-text-faint">{card.sub}</p>}
        </div>
        {card.badge && (
          <span className="shrink-0 text-[9.5px]" style={{ color: card.badgeColor || C.mut }}>
            {card.badge}
          </span>
        )}
      </div>

      {card.pills && card.pills.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {card.pills.map(p => (
            <span key={p} className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9.5px] text-text-muted">
              {p}
            </span>
          ))}
        </div>
      )}

      {card.bar != null && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="h-[7px] flex-1 overflow-hidden rounded-[3px] bg-surface">
            <div style={segStyle(card.barColor || C.vio, card.bar)} />
          </div>
          <span className="text-[10px] text-amber">{card.barLabel}</span>
        </div>
      )}

      {card.rows && card.rows.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-[3px]">
          {card.rows.map(([k, v, color]) => (
            <div key={k} className="flex justify-between gap-2.5 text-[10px]">
              <span className="text-text-ghost">{k}</span>
              <span style={{ color: color || C.txt }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {card.diffNew != null && (
        <div className="mt-2.5 overflow-hidden rounded-[7px] border border-border">
          <div className="flex gap-2 px-[9px] py-1 border-b border-border" style={{ background: 'rgba(69,10,10,.28)' }}>
            <span className="text-danger">−</span>
            <span className="text-[10.5px] text-[#fca5a5]">{card.diffOld}</span>
          </div>
          <div className="flex gap-2 px-[9px] py-1" style={{ background: 'rgba(5,46,22,.3)' }}>
            <span className="text-success">+</span>
            <span className="text-[10.5px] text-[#86efac]">{card.diffNew}</span>
          </div>
        </div>
      )}

      {card.actions && card.actions.length > 0 && (
        <div className="mt-[11px] flex gap-1.5">
          {card.actions.map(([label, primary]) => (
            <button
              key={label}
              onClick={() => card.onAction?.(label)}
              className={
                primary
                  ? 'rounded-md px-2.5 py-1 text-[10px] font-medium text-white shadow-[0_0_13px_rgba(109,40,217,.45)]'
                  : 'rounded-md border border-[#3f3f46] bg-surface px-2.5 py-1 text-[10px] text-text-secondary'
              }
              style={primary ? { background: '#6d28d9' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {card.foot && <p className="mt-2 text-[9.5px] text-text-ghost/70">{card.foot}</p>}
    </div>
  )
}

export function CardGrid({ cards, columns = true }: { cards: CardSpec[]; columns?: boolean }) {
  return (
    <div
      className={columns ? 'grid gap-2.5' : 'flex flex-col gap-2'}
      style={columns ? { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } : undefined}
    >
      {cards.map(c => (
        <InfoCard key={c.title} card={c} />
      ))}
    </div>
  )
}

// ── Data table ────────────────────────────────────────────────────────────

export interface TableCol {
  label: string
  align?: 'left' | 'right' | 'center'
}
export interface TableCell {
  v: ReactNode
  color?: string
  align?: 'left' | 'right' | 'center'
}

export function col(label: string, align?: 'left' | 'right' | 'center'): TableCol {
  return { label, align }
}
export function cell(v: ReactNode, color?: string, align?: 'left' | 'right' | 'center'): TableCell {
  return { v, color, align }
}

export function DataTable({
  title,
  titleColor,
  cols,
  rows,
}: {
  title?: string
  titleColor?: string
  cols: TableCol[]
  rows: TableCell[][]
}) {
  return (
    <div>
      {title && (
        <p className="m-0 mb-2 flex items-center gap-[7px] text-[11px] text-text-secondary">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: titleColor || C.vio, boxShadow: `0 0 8px ${titleColor || C.vio}` }}
          />
          {title}
        </p>
      )}
      <div className="overflow-x-auto overflow-y-hidden rounded-[10px] border border-border bg-[#101012]">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-text-muted">
              {cols.map(c => (
                <th
                  key={c.label}
                  className="px-2.5 py-[7px] text-[10px] font-medium uppercase tracking-[.1em]"
                  style={{ textAlign: c.align || 'left' }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface transition-colors">
                {row.map((c, j) => (
                  <td
                    key={j}
                    className="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-[5px]"
                    style={{ color: c.color || C.txt, textAlign: c.align || 'left' }}
                  >
                    {c.v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Note callout ────────────────────────────────────────────────────────

export function NoteBox({ notes }: { notes: ReactNode[] }) {
  return (
    <div
      className="flex max-w-[760px] gap-2.5 rounded-[10px] border border-border px-[15px] py-[13px]"
      style={{ background: 'rgba(16,16,18,.7)' }}
    >
      <span className="mt-1 h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: C.V, boxShadow: `0 0 8px ${C.V}` }} />
      <div className="flex flex-col gap-1.5">
        {notes.map((n, i) => (
          <p key={i} className="m-0 text-[10.5px] leading-[1.7] text-text-faint" style={{ textWrap: 'pretty' as 'pretty' }}>
            {n}
          </p>
        ))}
      </div>
    </div>
  )
}

// ── Screen scaffold ────────────────────────────────────────────────────────

export function ScreenHeaderRow({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <h1 className="m-0 text-xl font-bold text-text-primary">{title}</h1>
      {subtitle && (
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-text-muted">
          {subtitle}
        </span>
      )}
      <div className="flex-1" />
      {action}
    </div>
  )
}
