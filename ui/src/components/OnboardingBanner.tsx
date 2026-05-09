import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSystemStatus } from '../lib/api'
import { Sparkles, FolderOpen, BarChart3, ArrowRight } from 'lucide-react'

export default function OnboardingBanner() {
  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: getSystemStatus,
    staleTime: 30_000,
  })

  if (!status?.first_boot) return null

  return (
    <div className="mx-auto mb-8 rounded-2xl border border-violet-800/40 bg-gradient-to-br from-violet-950/50 via-zinc-900 to-zinc-900 p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-900/50">
          <Sparkles className="h-5 w-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-zinc-100 mb-1">Welcome to Phonolith</h2>
          <p className="text-sm text-zinc-400 mb-4">
            Your library is empty. Add a music directory to start ingesting, or connect Last.fm / Plex
            to use Phonolith as an analytics-only platform with no local files required.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              to="/sources"
              className="flex items-center gap-3 rounded-xl border border-violet-700/50 bg-violet-900/20 px-4 py-3 hover:bg-violet-900/40 transition-colors"
            >
              <FolderOpen className="h-4 w-4 text-violet-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">Add a library source</p>
                <p className="text-xs text-zinc-500">Point Tremor at your music directory</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-zinc-600 ml-auto flex-shrink-0" />
            </Link>

            <Link
              to="/settings"
              className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800/40 px-4 py-3 hover:bg-zinc-800/80 transition-colors"
            >
              <BarChart3 className="h-4 w-4 text-zinc-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">Connect Last.fm or Plex</p>
                <p className="text-xs text-zinc-500">Analytics-only — no local files needed</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-zinc-600 ml-auto flex-shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
