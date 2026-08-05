'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { LibraryFile } from '@/lib/types'

interface LibraryTableProps {
  files: LibraryFile[]
}

function DRBadge({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-text-muted">—</span>
  const color = score >= 12 ? 'text-success' : score >= 8 ? 'text-warning' : 'text-danger'
  return <span className={`font-mono ${color}`}>DR{Math.round(score)}</span>
}

function QualityBadge({ ok }: { ok?: boolean | null }) {
  if (ok == null) return <span className="text-text-muted">—</span>
  return ok ? (
    <span className="text-success">✓</span>
  ) : (
    <span className="text-danger">✗</span>
  )
}

export default function LibraryTable({ files }: LibraryTableProps) {
  const [formatFilter, setFormatFilter] = useState('all')
  const [drFilter, setDrFilter] = useState('all')
  const [matchFilter, setMatchFilter] = useState('all')

  const filtered = files.filter(f => {
    if (formatFilter !== 'all' && f.format?.toLowerCase() !== formatFilter) return false
    if (drFilter === 'high' && (f.dr_score == null || f.dr_score < 12)) return false
    if (drFilter === 'mid' && (f.dr_score == null || f.dr_score < 8 || f.dr_score >= 12)) return false
    if (drFilter === 'low' && (f.dr_score == null || f.dr_score >= 8)) return false
    if (matchFilter === 'matched' && !f.song_id) return false
    if (matchFilter === 'unmatched' && f.song_id) return false
    return true
  })

  const formats = Array.from(new Set(files.map(f => f.format).filter(Boolean))) as string[]

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={formatFilter}
          onChange={e => setFormatFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="all">All formats</option>
          {formats.map(f => <option key={f} value={f.toLowerCase()}>{f.toUpperCase()}</option>)}
        </select>
        <select
          value={drFilter}
          onChange={e => setDrFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="all">All DR</option>
          <option value="high">High DR (≥12)</option>
          <option value="mid">Mid DR (8–11)</option>
          <option value="low">Low DR (&lt;8)</option>
        </select>
        <select
          value={matchFilter}
          onChange={e => setMatchFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="all">All files</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="text-left px-4 py-3 text-xs text-text-muted font-medium uppercase tracking-wider">File</th>
              <th className="text-left px-4 py-3 text-xs text-text-muted font-medium uppercase tracking-wider">Format</th>
              <th className="text-left px-4 py-3 text-xs text-text-muted font-medium uppercase tracking-wider">DR</th>
              <th className="text-left px-4 py-3 text-xs text-text-muted font-medium uppercase tracking-wider">Quality</th>
              <th className="text-left px-4 py-3 text-xs text-text-muted font-medium uppercase tracking-wider">Matched Song</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => (
              <tr
                key={f.id}
                className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors cursor-pointer"
                onClick={() => window.location.href = `/library/${f.blake3_hash}`}
              >
                <td className="px-4 py-3 font-mono text-xs text-text-muted max-w-xs truncate">
                  {f.file_path.split('/').pop()}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {f.format?.toUpperCase() ?? '—'}
                  {f.bit_depth && f.sample_rate && (
                    <span className="text-text-muted ml-1">{f.bit_depth}/{Math.round(f.sample_rate / 1000)}k</span>
                  )}
                </td>
                <td className="px-4 py-3"><DRBadge score={f.dr_score} /></td>
                <td className="px-4 py-3"><QualityBadge ok={f.spectral_ok} /></td>
                <td className="px-4 py-3 text-text-primary">
                  {f.song_title ? (
                    <span>{f.song_title} <span className="text-text-muted">— {f.song_artist}</span></span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center text-text-muted">
            No files match the current filters.
          </div>
        )}
      </div>
    </div>
  )
}
