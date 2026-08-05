'use client'

import { useCurrentPageHeader } from '@/contexts/PageHeaderContext'
import { useLibraryStatus } from '@/hooks/useLibraryStatus'
import Notifications from './Notifications'

/**
 * The persistent "instrument panel" strip above every page's content. Pages
 * set their title/subtitle via usePageHeader(); this renders it plus a small
 * cluster of live status readouts.
 *
 * The Claude Design mockup this is ported from shows fabricated ops-dashboard
 * widgets here (a "DUCKDB 41,882"-style VU-meter readout, a fake "NATS ·
 * JetStream" pill, a "24/24 svc" footer badge) modelling infrastructure
 * (DuckDB, a NATS service mesh) that doesn't exist in this stack yet — those
 * belong to the EchoGraph/Signal Mesh subsystems, which are later phases of
 * this redesign. Until they're real, this header only shows numbers actually
 * being polled right now: the Analyst sidecar's live reachability and the
 * real indexed-track count from Postgres.
 */
export default function AppHeader() {
  const { title, subtitle } = useCurrentPageHeader()
  const status = useLibraryStatus()

  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 h-11 shrink-0 px-5 border-b border-border bg-[#101012]">
      <span className="text-[11px] font-semibold tracking-[.16em] uppercase text-text-primary [text-shadow:0_0_9px_rgba(167,139,250,.45)]">
        {title}
      </span>
      {subtitle && <span className="text-[10px] text-text-ghost truncate">{subtitle}</span>}

      <div className="flex-1" />

      <span className="flex items-center gap-1.5 text-[10px] text-text-faint shrink-0">
        <span
          className={`w-[5px] h-[5px] rounded-full ${status?.online ? 'bg-success shadow-[0_0_7px_theme(colors.success)]' : 'bg-text-ghost'}`}
        />
        Analyst {status?.online ? 'online' : 'offline'}
      </span>

      <span
        className="hidden sm:flex items-center gap-1.5 border border-border rounded px-2 py-0.5 shrink-0"
        style={{
          background: 'linear-gradient(180deg,#0a0a0c,#141418)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05), inset 0 0 12px rgba(0,0,0,.7)',
        }}
      >
        <span className="text-[9px] tracking-[.14em] text-text-ghost">LIBRARY</span>
        <span className="text-[11px] font-bold tracking-[.05em] text-amber [text-shadow:0_0_8px_rgba(255,179,64,.6)]">
          {(status?.files_indexed ?? 0).toLocaleString()}
        </span>
      </span>

      <Notifications />

      <span className="hidden md:inline border border-border rounded px-1.5 py-0.5 text-[10px] text-text-faint shrink-0">
        ⌘K
      </span>
    </header>
  )
}
