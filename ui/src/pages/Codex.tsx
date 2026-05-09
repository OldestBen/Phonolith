import { useQuery } from '@tanstack/react-query'
import { getCodexStats, getCodexExportUrl, type CodexStats } from '../lib/api'
import { Download, BookOpen, Music, Users, Disc, Clock, BarChart2, Star } from 'lucide-react'

function StatCard({ icon: Icon, label, value }: { icon: React.FC<{ className?: string }>; label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-zinc-500 text-xs">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="text-2xl font-bold text-zinc-100 font-mono">{value}</p>
    </div>
  )
}

export default function Codex() {
  const { data: stats, isLoading } = useQuery<CodexStats>({
    queryKey: ['codex-stats'],
    queryFn: getCodexStats,
    staleTime: 60_000,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Sonic Codex</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-xl">
          Export your entire library intelligence as a single compressed <code className="font-mono text-violet-400">.codex</code> file.
          Zero audio — just hashes, DR scores, ratings, acoustic data, and scrobble history.
          Share as a "Ghost Library" or use as an architectural blueprint to rebuild after a loss.
        </p>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Music}    label="Tracks"       value={stats.track_count.toLocaleString()} />
          <StatCard icon={Users}    label="Artists"      value={stats.artist_count.toLocaleString()} />
          <StatCard icon={Disc}     label="Albums"       value={stats.album_count.toLocaleString()} />
          <StatCard icon={Clock}    label="Hours"        value={stats.total_hours.toLocaleString()} />
          <StatCard icon={BarChart2} label="DR analyzed" value={stats.dr_analyzed.toLocaleString()} />
          <StatCard icon={Star}     label="Rated tracks" value={stats.rated_count.toLocaleString()} />
          <StatCard icon={BookOpen} label="Scrobbles"    value={stats.play_event_count.toLocaleString()} />
        </div>
      ) : null}

      {/* Export card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 max-w-lg">
        <div className="flex items-start gap-3">
          <BookOpen className="w-8 h-8 text-violet-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">Export phonolith.codex</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Gzip-compressed SQLite containing tracks, albums, scrobble history,
              and all acoustic metadata. No audio data, no local paths.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            Portable — no absolute paths, only BLAKE3 hashes as identifiers
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            Compact — typically a few MB even for 100k-track libraries
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            Importable by peers as a "Ghost Library" for browsing your collection
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
            Contains ratings and play history — treat as semi-private
          </div>
        </div>

        <a
          href={getCodexExportUrl()}
          download="phonolith.codex"
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors w-fit"
        >
          <Download className="w-4 h-4" />
          Download .codex
        </a>
      </div>

      {/* Schema reference */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 max-w-lg">
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Codex schema v1.0</p>
        <div className="flex flex-col gap-2 text-xs font-mono">
          {[
            ['tracks',      '43 columns — all metadata, DR, ratings, acoustic data'],
            ['albums',      '13 columns — artwork dimensions, avg DR, Discogs value'],
            ['play_events', '7 columns — full scrobble history with format info'],
            ['codex_meta',  'created_at, track_count, schema_version'],
          ].map(([table, desc]) => (
            <div key={table} className="flex gap-3">
              <span className="text-violet-400 w-28 flex-shrink-0">{table}</span>
              <span className="text-zinc-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
