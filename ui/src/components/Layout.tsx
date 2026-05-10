import { NavLink, Outlet } from 'react-router-dom'
import {
  Waves, Music, BarChart3, Cpu, Shield, Settings, SearchCode,
  GitCompare, Mic2, Trash2, ListMusic, Network, BookOpen,
  Headphones, SlidersHorizontal, Copy, FolderOpen, PieChart, HardDrive,
} from 'lucide-react'
import clsx from 'clsx'
import PlayerBar from './PlayerBar'
import OnboardingBanner from './OnboardingBanner'
import TaskMonitor from './TaskMonitor'
import { useTaskEvents } from '../lib/useTaskEvents'

type NavGroup = {
  label: string
  items: { to: string; label: string; icon: React.FC<{ className?: string }>; end?: boolean }[]
}

const navGroups: NavGroup[] = [
  {
    label: 'Library',
    items: [
      { to: '/',          label: 'Library',     icon: Music,             end: true },
      { to: '/search',    label: 'Search',       icon: SearchCode },
      { to: '/versions',  label: 'Versions',     icon: GitCompare },
      { to: '/playlists', label: 'Playlists',    icon: ListMusic },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/analytics',   label: 'Analytics',   icon: BarChart3 },
      { to: '/engineers',   label: 'Engineers',   icon: Mic2 },
      { to: '/cathode',       label: 'Cathode',       icon: Headphones },
      { to: '/completeness',  label: 'Completeness',  icon: PieChart },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/janitor',     label: 'Janitor',     icon: Trash2 },
      { to: '/dedup',       label: 'Dedup',       icon: Copy },
      { to: '/eq-profiles', label: 'EQ Profiles', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/sources',   label: 'Sources',     icon: FolderOpen },
      { to: '/dap',       label: 'DAP',         icon: HardDrive },
      { to: '/hardware',  label: 'Hardware',    icon: Cpu },
      { to: '/polyphony', label: 'Polyphony',   icon: Network },
      { to: '/vault',     label: 'Vault',       icon: Shield },
      { to: '/codex',     label: 'Sonic Codex', icon: BookOpen },
      { to: '/settings',  label: 'Settings',    icon: Settings },
    ],
  },
]

export default function Layout() {
  const { events, clear } = useTaskEvents()

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0c0c0e] text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-800 bg-[#18181b] overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 flex-shrink-0">
          <Waves className="h-5 w-5 text-violet-500" strokeWidth={2} />
          <span className="text-lg font-bold tracking-widest text-violet-500 uppercase">
            Phonolith
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-4 px-3 py-2 pb-4">
          {navGroups.map(group => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-violet-900/30 text-violet-400'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                      )
                    }
                  >
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 text-xs text-zinc-700 border-t border-zinc-800 flex-shrink-0">
          Phonolith v0.1.0
        </div>
      </aside>

      {/* Main content + player */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <OnboardingBanner />
          <Outlet />
        </main>
        <PlayerBar />
      </div>

      <TaskMonitor events={events} onClear={clear} />
    </div>
  )
}
