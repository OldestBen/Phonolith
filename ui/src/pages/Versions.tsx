import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, Star, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { apiFetch } from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionGroup {
  group_key: string
  album: string
  artist: string
  version_count: number
}

interface Version {
  hash: string
  path: string
  filename: string
  title: string
  artist: string
  album: string
  year: number | null
  format: string | null
  bit_depth: number | null
  sample_rate: number | null
  bitrate_kbps: number | null
  duration_seconds: number | null
  dr_score: number | null
  peak_level: number | null
  rms_level: number | null
  label: string | null
  mastered_by: string | null
  engineer: string | null
  is_primary_version: boolean
  is_shadowed: boolean
  prism_status: string | null
  loudness_war_flag?: boolean
}

// ── API helpers ───────────────────────────────────────────────────────────────

function getVersionGroups(): Promise<VersionGroup[]> {
  return apiFetch('/api/versions')
}

function getVersionGroup(key: string): Promise<Version[]> {
  return apiFetch(`/api/versions/${encodeURIComponent(key)}`)
}

function setPrimary(hash: string): Promise<{ status: string }> {
  return apiFetch('/api/versions/set-primary', {
    method: 'POST',
    body: JSON.stringify({ hash }),
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DrCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-zinc-600">—</span>
  const color = score >= 14 ? 'text-green-400' : score >= 8 ? 'text-yellow-400' : 'text-red-400'
  return <span className={clsx('font-mono font-bold', color)}>DR{score}</span>
}

function FormatBadge({ v }: { v: Version }) {
  const parts = [v.format ?? '?', v.bit_depth ? `${v.bit_depth}b` : null, v.sample_rate ? `${(v.sample_rate / 1000).toFixed(v.sample_rate % 1000 === 0 ? 0 : 1)}kHz` : null]
  return (
    <span className="font-mono text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
      {parts.filter(Boolean).join(' ')}
    </span>
  )
}

function VersionRow({ v, onSetPrimary }: { v: Version; onSetPrimary: (hash: string) => void }) {
  return (
    <tr className={clsx(
      'border-b border-zinc-800/40 text-sm',
      v.is_shadowed && 'opacity-40',
    )}>
      <td className="px-3 py-2.5 w-8 text-center">
        {v.is_primary_version
          ? <Star className="w-4 h-4 text-violet-400 fill-violet-400 inline" />
          : <button onClick={() => onSetPrimary(v.hash)} title="Set as primary" className="opacity-0 group-hover:opacity-100 hover:text-violet-400 transition">
              <Star className="w-4 h-4 text-zinc-600 inline" />
            </button>
        }
      </td>
      <td className="px-3 py-2.5 text-zinc-300">{v.year ?? '—'}</td>
      <td className="px-3 py-2.5"><FormatBadge v={v} /></td>
      <td className="px-3 py-2.5"><DrCell score={v.dr_score} /></td>
      <td className="px-3 py-2.5 font-mono text-xs text-zinc-400">
        {v.peak_level != null ? `${v.peak_level.toFixed(2)} dBFS` : '—'}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-zinc-400">
        {v.rms_level != null ? `${v.rms_level.toFixed(2)} dBFS` : '—'}
      </td>
      <td className="px-3 py-2.5 text-zinc-500 text-xs truncate max-w-[140px]">{v.label ?? '—'}</td>
      <td className="px-3 py-2.5 text-zinc-500 text-xs truncate max-w-[140px]">{v.mastered_by ?? '—'}</td>
      <td className="px-3 py-2.5 text-center">
        {v.loudness_war_flag && (
          <span title="DR lower than the original pressing — possible loudness war victim">
            <AlertTriangle className="w-4 h-4 text-orange-400 inline" />
          </span>
        )}
        {v.prism_status === 'fraud' && (
          <span title="Suspected fake lossless / upscale">
            <AlertTriangle className="w-4 h-4 text-red-500 inline ml-1" />
          </span>
        )}
        {v.prism_status === 'clean' && !v.loudness_war_flag && (
          <CheckCircle className="w-4 h-4 text-green-500/50 inline" />
        )}
      </td>
    </tr>
  )
}

function GroupRow({ group }: { group: VersionGroup }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const { data: versions, isLoading } = useQuery({
    queryKey: ['version-group', group.group_key],
    queryFn: () => getVersionGroup(group.group_key),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: setPrimary,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['version-group', group.group_key] }),
  })

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-800/50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
               : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{group.album}</p>
          <p className="text-xs text-zinc-500">{group.artist}</p>
        </div>
        <span className="text-xs text-violet-400 font-mono bg-violet-900/20 px-2 py-0.5 rounded">
          {group.version_count} versions
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800">
          {isLoading ? (
            <p className="text-zinc-500 text-sm p-4">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-left border-b border-zinc-800 text-xs uppercase tracking-wider">
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">Year</th>
                    <th className="px-3 py-2">Format</th>
                    <th className="px-3 py-2">DR</th>
                    <th className="px-3 py-2">Peak</th>
                    <th className="px-3 py-2">RMS</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Mastered by</th>
                    <th className="px-3 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody className="group">
                  {(versions ?? []).map(v => (
                    <VersionRow
                      key={v.hash}
                      v={v}
                      onSetPrimary={hash => mutation.mutate(hash)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Versions() {
  const { data: groups, isLoading } = useQuery({
    queryKey: ['version-groups'],
    queryFn: getVersionGroups,
  })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Version Manager</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Albums with multiple pressings in your library — compare DR, peak, RMS and set your preferred version.
          <span className="ml-2 text-orange-400">⚠</span> = loudness war victim (remaster has lower DR than original).
        </p>
      </div>

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : !groups?.length ? (
        <p className="text-zinc-600 text-sm py-8 text-center">
          No albums with multiple versions found yet — they appear as tracks are ingested.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(g => <GroupRow key={g.group_key} group={g} />)}
        </div>
      )}
    </div>
  )
}
