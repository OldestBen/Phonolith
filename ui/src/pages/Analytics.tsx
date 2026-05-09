import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  getAnalyticsOverview, getGhostReport, getLabelBreakdown, getDRHeatmap,
} from '../lib/api'

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-zinc-100">{value}</div>
    </div>
  )
}

function drColor(dr: number) {
  if (dr >= 14) return '#4ade80'
  if (dr >= 10) return '#a3e635'
  if (dr >= 8)  return '#facc15'
  if (dr >= 5)  return '#fb923c'
  return '#f87171'
}

export default function Analytics() {
  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: getAnalyticsOverview })
  const { data: ghost }    = useQuery({ queryKey: ['ghost-report'],       queryFn: getGhostReport })
  const { data: labels }   = useQuery({ queryKey: ['label-breakdown'],    queryFn: getLabelBreakdown })
  const { data: drData }   = useQuery({ queryKey: ['dr-heatmap'],         queryFn: getDRHeatmap })

  const losslessPct = overview
    ? Math.round(((overview.lossless_count ?? 0) / (overview.total_tracks || 1)) * 100)
    : 0

  return (
    <div className="flex flex-col gap-6">
      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Tracks"  value={(overview?.total_tracks ?? '—').toLocaleString()} />
        <StatCard label="Total Albums"  value={(overview?.total_albums ?? '—').toLocaleString()} />
        <StatCard label="Avg DR Score"  value={overview?.avg_dr ? `DR${overview.avg_dr}` : '—'} />
        <StatCard label="Lossless"      value={overview ? `${losslessPct}%` : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DR heatmap */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Dynamic Range Distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={drData ?? []} margin={{ left: -20 }}>
              <XAxis dataKey="dr" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                labelStyle={{ color: '#e4e4e7' }}
                itemStyle={{ color: '#a1a1aa' }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {(drData ?? []).map((entry: { dr: number; count: number }) => (
                  <Cell key={entry.dr} fill={drColor(entry.dr)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Label breakdown */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Top Labels</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={labels?.slice(0, 10) ?? []} layout="vertical" margin={{ left: 60 }}>
              <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickLine={false} width={60} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                labelStyle={{ color: '#e4e4e7' }}
              />
              <Bar dataKey="count" fill="#7c3aed" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ghost report */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-1">Ghost Report</h2>
        <p className="text-xs text-zinc-500 mb-4">Highly-rated tracks you haven't played in over a year</p>
        {!ghost?.length ? (
          <p className="text-zinc-600 text-sm">No ghosts found — your library is well-loved.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-left border-b border-zinc-800">
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Artist</th>
                  <th className="pb-2 font-medium">Rating</th>
                  <th className="pb-2 font-medium">Last Played</th>
                </tr>
              </thead>
              <tbody>
                {ghost.slice(0, 20).map(t => (
                  <tr key={t.id} className="border-b border-zinc-800/40">
                    <td className="py-2 text-zinc-200">{t.title ?? t.filename}</td>
                    <td className="py-2 text-zinc-400">{t.artist ?? '—'}</td>
                    <td className="py-2 text-yellow-400">{'★'.repeat(Math.round(t.internal_rating ?? 0))}</td>
                    <td className="py-2 text-zinc-500 text-xs">
                      {t.last_played_at ? new Date(t.last_played_at).toLocaleDateString() : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
