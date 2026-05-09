import { NavLink, Outlet } from 'react-router-dom'
import { Waves, Music, BarChart3, Cpu, Shield, Settings, SearchCode, GitCompare } from 'lucide-react'
import clsx from 'clsx'
import PlayerBar from './PlayerBar'

const navItems = [
  { to: '/',          label: 'Library',   icon: Music,       end: true },
  { to: '/search',    label: 'Search',    icon: SearchCode,  end: false },
  { to: '/versions',  label: 'Versions',  icon: GitCompare,  end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3,   end: false },
  { to: '/hardware',  label: 'Hardware',  icon: Cpu,         end: false },
  { to: '/vault',     label: 'Vault',     icon: Shield,      end: false },
  { to: '/settings',  label: 'Settings',  icon: Settings,    end: false },
]

export default function Layout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0c0c0e] text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-zinc-800 bg-[#18181b]">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5">
          <Waves className="h-6 w-6 text-violet-500" strokeWidth={2} />
          <span className="text-xl font-bold tracking-widest text-violet-500 uppercase">
            Phonolith
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-violet-900/30 text-violet-400'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 text-xs text-zinc-600">
          Phonolith v0.1.0
        </div>
      </aside>

      {/* Main content + player */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
        <PlayerBar />
      </div>
    </div>
  )
}
