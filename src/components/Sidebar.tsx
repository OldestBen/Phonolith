'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

// ── Mobile bottom-nav icons ──────────────────────────────────────────────────
// The desktop sidebar below is a 1:1 port of the Claude Design mockup, which
// targets a fixed large desktop viewport only (no responsive treatment at
// all — its own preview is pinned to 1560×940). Rather than lose mobile
// usability entirely, the existing icon-based mobile bottom nav is kept as a
// separate, deliberately-curated subset of the full nav below.

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  )
}
function LibraryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}
function CathodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
    </svg>
  )
}
function PolyphonyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <circle cx="4" cy="4" r="2" /><circle cx="20" cy="4" r="2" /><circle cx="4" cy="20" r="2" /><circle cx="20" cy="20" r="2" />
      <line x1="6" y1="6" x2="10" y2="10" /><line x1="18" y1="6" x2="14" y2="10" /><line x1="6" y1="18" x2="10" y2="14" /><line x1="18" y1="18" x2="14" y2="14" />
    </svg>
  )
}
function SoulcatcherIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M8 12a4 4 0 0 1 8 0" />
      <path d="M5 12a7 7 0 0 1 14 0" />
      <path d="M2 12a10 10 0 0 1 20 0" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

const MOBILE_NAV_ITEMS = [
  { href: '/', icon: SearchIcon, label: 'Search' },
  { href: '/library', icon: LibraryIcon, label: 'Library' },
  { href: '/cathode', icon: CathodeIcon, label: 'Cathode' },
  { href: '/polyphony', icon: PolyphonyIcon, label: 'Polyphony' },
  { href: '/soulcatcher', icon: SoulcatcherIcon, label: 'Soulcatcher' },
  { href: '/settings', icon: SettingsIcon, label: 'Settings' },
]

// ── Desktop nav — grouped, ported from the Claude Design mockup's navGroups ──
// Phase-1 scope only (see docs/DESIGN_SYSTEM.md): groups/items for subsystems
// not yet rebuilt on the new design (Search, Playlists, EchoGraph,
// Completeness, Janitor, Dedup, EQ Profiles, DAP, Signal Mesh, Vault, Sonic
// Codex) are omitted rather than linking to pages that don't exist yet or
// haven't been redesigned — they're added group-by-group as each phase lands.
const NAV_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: 'Library',
    items: [
      { href: '/', label: 'Search' },
      { href: '/library', label: 'Library' },
      { href: '/history', label: 'History' },
      { href: '/tags', label: 'Tags' },
      { href: '/lyrics', label: 'Lyrics' },
      { href: '/versions', label: 'Versions' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/visualize', label: 'Galaxy' },
      { href: '/engineers', label: 'Engineers' },
      { href: '/cathode', label: 'Cathode' },
    ],
  },
  {
    label: 'Acquire',
    items: [
      { href: '/soulcatcher', label: 'Soulcatcher' },
      { href: '/sources', label: 'Sources' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/polyphony', label: 'Polyphony' },
      { href: '/docs', label: 'Docs' },
      { href: '/settings', label: 'Settings' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <>
      {/* Desktop sidebar — instrument-panel nav, grouped by subsystem layer */}
      <aside className="hidden md:flex fixed left-0 top-0 h-screen w-56 flex-col border-r border-border bg-surface overflow-y-auto z-50">
        <div className="flex items-center gap-2 px-4 pt-[18px] pb-4 shrink-0">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-accent shrink-0 shadow-[0_0_10px_rgba(139,92,246,.75),inset_0_0_5px_rgba(139,92,246,.5)]" />
          <span className="text-sm font-bold tracking-[.18em] text-accent uppercase [text-shadow:0_0_18px_rgba(139,92,246,.55)]">
            Phonolith
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-3.5 px-3 pb-4">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <p className="m-0 mb-1 px-2.5 text-[9px] font-semibold uppercase tracking-widest2 text-text-ghost">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map(item => {
                  const active = isActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 w-full rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-left transition-colors duration-100 border ${
                        active
                          ? 'border-accent-dim/40 bg-accent-dim/[.32] text-accent-bright'
                          : 'border-transparent text-text-muted hover:bg-surface-2 hover:text-text-primary'
                      }`}
                    >
                      <span
                        className={`w-[5px] h-[5px] rounded-[1px] shrink-0 ${
                          active ? 'bg-accent shadow-[0_0_7px_theme(colors.accent)]' : 'bg-text-ghost/60'
                        }`}
                      />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center justify-between px-4 py-2.5 border-t border-border text-[10px] text-text-ghost shrink-0 hover:text-text-muted transition-colors"
        >
          <span>v0.1.0</span>
          <span className="hover:text-danger transition-colors">Sign out</span>
        </button>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface
                      flex items-center justify-around px-2 py-2 z-50 md:hidden">
        {MOBILE_NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all ${
              isActive(item.href) ? 'text-accent' : 'text-text-muted'
            }`}
            aria-label={item.label}
          >
            <item.icon />
            <span className="text-xs">{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}
