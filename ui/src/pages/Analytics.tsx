import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Sankey, Rectangle,
} from 'recharts'
import {
  getAnalyticsOverview, getGhostReport, getLabelBreakdown, getDRHeatmap,
  getGenreEvolution, getBpmKeyMismatches,
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

// Sankey node renderer
function SankeyNode({ x, y, width, height, payload }: {
  x: number; y: number; width: number; height: number; payload: { name: string }
}) {
  return (
    <g>
      <Rectangle x={x} y={y} width={width} height={height} fill="#7c3aed" fillOpacity={0.8} radius={2} />
      <text
        x={x - 6}
        y={y + height / 2}
        textAnchor="end"
        dominantBaseline="middle"
        fill="#a1a1aa"
        fontSize={10}
        className="select-none"
      >
        {payload.name.split(' (')[0]}
      </text>
    </g>
  )
}

export default function Analytics() {
  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: getAnalyticsOverview })
  const { data: ghost }    = useQuery({ queryKey: ['ghost-report'],       queryFn: getGhostReport })
  const { data: labels }   = useQuery({ queryKey: ['label-breakdown'],    queryFn: getLabelBreakdown })
  const { data: drData }   = useQuery({ queryKey: ['dr-heatmap'],         queryFn: getDRHeatmap })
  const { data: sankey }   = useQuery({ queryKey: ['genre-evolution'],    queryFn: getGenreEvolution })
  const { data: mismatches } = useQuery({ queryKey: ['bpm-key-mismatches'], queryFn: getBpmKeyMismatches })

  const losslessPct = overview
    ? Math.round(((overview.lossless_count ?? 0) / (overview.total_tracks || 1)) * 100)
    : 0

  const hasSankeyData = sankey && sankey.nodes.length > 0 && sankey.links.length > 0

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

      {/* Genre evolution Sankey */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-1">Genre Evolution</h2>
        <p className="text-xs text-zinc-500 mb-4">
          How your listening has shifted across genres over 5-year periods — based on play history
        </p>
        {!hasSankeyData ? (
          <p className="text-zinc-600 text-sm">
            Genre evolution appears once you have play history with genre tags. Start listening!
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <Sankey
              data={{ nodes: sankey.nodes, links: sankey.links }}
              nodePadding={12}
              nodeWidth={14}
              linkCurvature={0.5}
              iterations={32}
              node={<SankeyNode x={0} y={0} width={0} height={0} payload={{ name: '' }} />}
              link={{ stroke: '#7c3aed', strokeOpacity: 0.3 }}
              margin={{ left: 80, right: 80, top: 10, bottom: 10 }}
            />
          </ResponsiveContainer>
        )}
      </div>

      {/* BPM / Key mismatches */}
      {mismatches && mismatches.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-1">BPM / Key Tag Mismatches</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Tracks where embedded BPM or key tags differ from librosa's audio analysis
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-left border-b border-zinc-800 text-xs">
                  <th className="pb-2 font-medium">Track</th>
                  <th className="pb-2 font-medium">Tag BPM</th>
                  <th className="pb-2 font-medium">Audio BPM</th>
                  <th className="pb-2 font-medium">Delta</th>
                  <th className="pb-2 font-medium">Tag Key</th>
                  <th className="pb-2 font-medium">Audio Key</th>
                </tr>
              </thead>
              <tbody>
                {mismatches.slice(0, 20).map(m => (
                  <tr key={m.hash} className="border-b border-zinc-800/40">
                    <td className="py-2 text-zinc-200 truncate max-w-[200px]">
                      {m.title ?? m.path.split('/').pop()}
                      {m.artist && <span className="text-zinc-500 ml-1">— {m.artist}</span>}
                    </td>
                    <td className="py-2 font-mono text-zinc-400 text-xs">
                      {m.tag_bpm?.toFixed(0) ?? '—'}
                    </td>
                    <td className="py-2 font-mono text-violet-400 text-xs">
                      {m.detected_bpm?.toFixed(0) ?? '—'}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      <span className={m.bpm_delta > 10 ? 'text-orange-400' : 'text-zinc-500'}>
                        ±{m.bpm_delta.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-zinc-400 text-xs">{m.tag_key ?? '—'}</td>
                    <td className="py-2 font-mono text-violet-400 text-xs">{m.detected_key ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                  <tr key={t.hash} className="border-b border-zinc-800/40">
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
