'use client'

/**
 * Mastering Engineer Matrix (matches the Claude Design mockup's `P.engineers`)
 * — ranks the `engineer` credit on library_files by average DR score.
 *
 * Real data only: /api/library/engineers reads library_files.engineer,
 * dr_score, format and accuraterip_status. The mockup's peak/RMS/star-rating
 * pills were dropped — no such columns exist anywhere in the schema.
 */

import { useEffect, useState } from 'react'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { ScreenDesc, CardGrid, drColor, type CardSpec } from '@/components/panel'
import type { EngineerStat } from '@/app/api/library/engineers/route'

export default function EngineersPage() {
  const [stats, setStats] = useState<EngineerStat[] | null>(null)

  useEffect(() => {
    fetch('/api/library/engineers')
      .then(r => (r.ok ? r.json() : []))
      .then(setStats)
      .catch(() => setStats([]))
  }, [])

  usePageHeader(
    'Mastering Engineer Matrix',
    stats ? `${stats.length} credit${stats.length === 1 ? '' : 's'} · ranked by average DR` : 'loading…'
  )

  const cards: CardSpec[] = (stats ?? []).map(e => {
    const dr = e.avg_dr

    return {
      title: e.engineer,
      sub: `${e.file_count} track${e.file_count === 1 ? '' : 's'} · ${e.pct_of_library}% of library`,
      dot: dr != null ? drColor(dr) : undefined,
      pills: [e.lossless_ratio],
      bar: dr != null ? Math.max(0, Math.min(100, (dr / 20) * 100)) : undefined,
      barColor: dr != null ? drColor(dr) : undefined,
      barLabel: dr != null ? `DR${dr.toFixed(1)}` : '—',
    }
  })

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[13px] px-6 py-6">
      <ScreenDesc>
        Engineers and masterers ranked by average Dynamic Range score across your library. DR ≥ 14
        excellent · DR ≥ 10 good · DR ≥ 8 fair · DR ≥ 5 compressed · DR &lt; 5 heavily compressed.
      </ScreenDesc>

      {stats == null ? (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-6 text-center">
          <p className="m-0 text-sm text-text-muted">Loading engineer credits…</p>
        </div>
      ) : stats.length > 0 ? (
        <CardGrid columns={false} cards={cards} />
      ) : (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-6 text-center">
          <p className="m-0 text-sm text-text-muted">No mastering credits found in your library yet.</p>
          <p className="mt-1 text-xs text-text-ghost">
            Engineer tags are read from ID3 TXXX:ENGINEER/TIPL/TMCL frames (or the FLAC/Vorbis
            `engineer` comment) during a deep scan.
          </p>
        </div>
      )}
    </div>
  )
}
