'use client'

/**
 * Version Manager — album detail (matches the Claude Design mockup's
 * `P.versions` table + "crest-factor gauge wall" canvas). Compares every
 * distinct format/bit-depth/sample-rate pressing of one album.
 *
 * Real data only: dr_avg, format and engineer (mockup's "Mastered by") all
 * come straight off library_files (via groupFileVersions). The mockup's
 * Peak/RMS/Label columns were dropped — no such columns exist anywhere in
 * the schema (see migrations, none define peak/rms/label). "Year" is derived
 * from the matched songs' release_date (falls back to the album's release
 * date), and the ⚠ loudness-war flag is computed for real: a version is
 * flagged only if an EARLIER-year version of the same album has a
 * meaningfully higher average DR (>= LOUDNESS_WAR_DR_DROP points) — nothing
 * here is hardcoded. The preferred-version star (column 1) is a live control
 * wired to PATCH /api/versions/[albumId]/preferred, not a static glyph.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { ScreenDesc, CanvasPanel, DataTable, NoteBox, col, cell, drColor, C } from '@/components/panel'

interface Track {
  blake3_hash: string
  song_title: string
  song_release_date?: string | null
  track_number?: number
  format?: string
  bit_depth?: number
  sample_rate?: number
  bitrate?: number
  duration_ms?: number
  dr_score?: number
  spectral_ok?: boolean
  accuraterip_status?: string
  engineer?: string | null
  is_preferred?: boolean
  file_path: string
}

interface Version {
  signature: string
  format?: string
  bit_depth?: number
  sample_rate?: number
  bitrate?: number
  dr_avg: number | null
  dr_scores: number[]
  spectral_ok: boolean
  accuraterip_status?: string
  is_preferred: boolean
  track_count: number
  tracks: Track[]
}

interface AlbumData {
  id: number
  name: string
  artist_name: string
  cover_art_url?: string
  release_date?: string
}

// A version's dr_avg counts as a loudness-war casualty if it drops at least
// this many DR points below an earlier pressing of the same album — small
// engineering variance between remasters shouldn't trip the flag.
const LOUDNESS_WAR_DR_DROP = 2

function formatHz(hz?: number): string {
  if (!hz) return '—'
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`
}

function formatLabel(v: Version): string {
  return (
    [v.format?.toUpperCase(), v.bit_depth && `${v.bit_depth}bit`, formatHz(v.sample_rate)]
      .filter(Boolean)
      .join(' / ') || v.signature
  )
}

/** Most common non-null `engineer` credit among a version's tracks. */
function primaryEngineer(tracks: Track[]): string | null {
  const counts = new Map<string, number>()
  for (const t of tracks) {
    if (t.engineer) counts.set(t.engineer, (counts.get(t.engineer) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  counts.forEach((c, name) => {
    if (c > bestCount) { best = name; bestCount = c }
  })
  return best
}

/** Representative release year for a version: the most common year among
 * its tracks' matched-song release dates, falling back to the album's own
 * release date if the songs carry none. */
function versionYear(v: Version, albumReleaseDate?: string): number | null {
  const counts = new Map<number, number>()
  for (const t of v.tracks) {
    if (!t.song_release_date) continue
    const y = new Date(t.song_release_date).getFullYear()
    if (!Number.isNaN(y)) counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  if (counts.size > 0) {
    let bestYear: number | null = null
    let bestCount = 0
    counts.forEach((c, y) => {
      if (c > bestCount || (c === bestCount && (bestYear == null || y < bestYear))) {
        bestYear = y
        bestCount = c
      }
    })
    return bestYear
  }
  if (albumReleaseDate) {
    const y = new Date(albumReleaseDate).getFullYear()
    if (!Number.isNaN(y)) return y
  }
  return null
}

interface GaugeDatum {
  label: string
  dr: number
  lw: boolean
  preferred: boolean
}

export default function VersionComparePage() {
  const { albumId } = useParams<{ albumId: string }>()
  const [album, setAlbum] = useState<AlbumData | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSignature, setSavingSignature] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/versions/${albumId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) { setAlbum(data.album); setVersions(data.versions) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [albumId])

  usePageHeader(
    album?.name ?? 'Version Manager',
    album ? `${album.artist_name} · ${versions.length} version${versions.length === 1 ? '' : 's'}` : 'loading…'
  )

  const hasExplicitPreferred = versions.some(v => v.is_preferred)

  // Which signature is *effectively* preferred right now: the user's
  // explicit pick if one exists, otherwise the DR-sorted default (index 0,
  // since the API already sorts best-quality-first).
  const effectivePreferredSignature = hasExplicitPreferred
    ? versions.find(v => v.is_preferred)?.signature
    : versions[0]?.signature

  // Loudness-war casualties, computed once per versions/album load.
  const years = new Map(versions.map(v => [v.signature, versionYear(v, album?.release_date)]))
  const lwFlagged = new Set<string>()
  for (const v of versions) {
    const y = years.get(v.signature)
    if (y == null || v.dr_avg == null) continue
    for (const other of versions) {
      if (other.signature === v.signature) continue
      const oy = years.get(other.signature)
      if (oy == null || other.dr_avg == null) continue
      if (oy < y && other.dr_avg - v.dr_avg >= LOUDNESS_WAR_DR_DROP) {
        lwFlagged.add(v.signature)
        break
      }
    }
  }

  // ── Gauge wall canvas — fed via a ref so the animation loop (mounted
  // once by CanvasPanel) always reads current data instead of a stale
  // closure from first render. ──────────────────────────────────────────
  const gaugeRef = useRef<GaugeDatum[]>([])
  useEffect(() => {
    gaugeRef.current = versions.map(v => ({
      label: [years.get(v.signature), v.format?.toUpperCase()].filter(Boolean).join(' · ') || v.signature,
      dr: v.dr_avg ?? 0,
      lw: lwFlagged.has(v.signature),
      preferred: v.signature === effectivePreferredSignature,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, album])

  const drawGaugeWall = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h)
    const list = gaugeRef.current
    if (list.length === 0) return

    const n = list.length
    const colW = w / n
    const cy = h * 0.56
    const outerR = Math.max(20, Math.min(colW * 0.38, h * 0.32))
    const innerR = outerR * 0.66
    const midR = (outerR + innerR) / 2
    const start = Math.PI * 0.75
    const end = Math.PI * 2.25
    const sweep = end - start

    list.forEach((g, i) => {
      const cx = colW * (i + 0.5)
      const pct = Math.max(0, Math.min(1, g.dr / 20))
      const valueAngle = start + pct * sweep

      // Track ring.
      ctx.beginPath()
      ctx.arc(cx, cy, midR, start, end)
      ctx.lineWidth = outerR - innerR
      ctx.strokeStyle = 'rgba(255,255,255,.05)'
      ctx.stroke()

      // Faint red backing on the whole ring for a flagged (loudness-war) version.
      if (g.lw) {
        ctx.beginPath()
        ctx.arc(cx, cy, midR, start, end)
        ctx.lineWidth = outerR - innerR
        ctx.strokeStyle = 'rgba(248,113,113,.2)'
        ctx.stroke()
      }

      // Live value arc, colored the same as the DR table cell.
      const color = drColor(g.dr)
      ctx.beginPath()
      ctx.arc(cx, cy, midR, start, Math.max(valueAngle, start + 0.001))
      ctx.lineWidth = outerR - innerR
      ctx.strokeStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = g.preferred ? 14 : 6
      ctx.stroke()
      ctx.shadowBlur = 0

      // Needle — points at the same angle the value arc ends at.
      const nx = cx + Math.cos(valueAngle) * (outerR - 3)
      const ny = cy + Math.sin(valueAngle) * (outerR - 3)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(nx, ny)
      ctx.lineWidth = 1.4
      ctx.strokeStyle = '#f4f4f5'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = '#f4f4f5'
      ctx.fill()

      // Labels.
      ctx.textAlign = 'center'
      ctx.font = '700 12px ui-monospace, "JetBrains Mono", monospace'
      ctx.fillStyle = color
      ctx.fillText(`DR${g.dr.toFixed(0)}`, cx, cy + outerR * 0.55)
      ctx.font = '500 8px ui-monospace, "JetBrains Mono", monospace'
      ctx.fillStyle = '#71717a'
      ctx.fillText(g.label, cx, cy + outerR * 0.55 + 12)

      if (g.lw) {
        ctx.fillStyle = '#f87171'
        ctx.font = '700 10px ui-monospace, "JetBrains Mono", monospace'
        ctx.fillText('⚠', cx, cy - outerR - (g.preferred ? 18 : 6))
      }
      if (g.preferred) {
        ctx.fillStyle = '#ffb340'
        ctx.font = '700 10px ui-monospace, "JetBrains Mono", monospace'
        ctx.fillText('★', cx, cy - outerR - 6)
      }
    })
  }, [])

  async function setPreferred(signature: string) {
    if (!albumId) return
    setSavingSignature(signature)
    try {
      const res = await fetch(`/api/versions/${albumId}/preferred`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      })
      if (res.ok) {
        setVersions(prev => prev.map(v => ({ ...v, is_preferred: v.signature === signature })))
      }
    } catch {
      // best-effort — the button will just re-enable
    } finally {
      setSavingSignature(null)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[900px] animate-pulse space-y-4 px-6 py-6">
        <div className="h-6 w-48 rounded bg-surface-2" />
        <div className="h-64 rounded-xl bg-surface-2" />
        <div className="h-40 rounded-xl bg-surface-2" />
      </div>
    )
  }

  if (!album) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-text-muted">Album not found.</p>
      </div>
    )
  }

  const rows = versions.map(v => {
    const year = years.get(v.signature)
    const isEffectivePreferred = v.signature === effectivePreferredSignature
    const lw = lwFlagged.has(v.signature)
    const engineer = primaryEngineer(v.tracks)

    let flagGlyph = '—'
    let flagColor = C.mut
    if (lw) {
      flagGlyph = '⚠'
      flagColor = C.red
    } else if (v.spectral_ok === false) {
      flagGlyph = '⚠'
      flagColor = C.orange
    } else if (v.spectral_ok) {
      flagGlyph = '✓'
      flagColor = C.green
    }

    return [
      cell(
        isEffectivePreferred ? (
          <span title="Preferred version" style={{ color: C.amb, textShadow: `0 0 6px ${C.amb}66` }}>
            ★
          </span>
        ) : (
          <button
            onClick={() => setPreferred(v.signature)}
            disabled={savingSignature === v.signature}
            title="Set as preferred version"
            aria-label="Set as preferred version"
            className="text-text-ghost transition-colors hover:text-amber disabled:opacity-50"
          >
            {savingSignature === v.signature ? '…' : '☆'}
          </button>
        ),
        undefined,
        'center'
      ),
      cell(year ?? '—', C.txt),
      cell(formatLabel(v), C.dim),
      cell(v.dr_avg != null ? `DR${v.dr_avg}` : '—', v.dr_avg != null ? drColor(v.dr_avg) : C.mut),
      cell(engineer ?? '—', C.mut),
      cell(flagGlyph, flagColor, 'center'),
    ]
  })

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-3.5 px-6 py-6 pb-20 md:pb-8">
      <Link
        href="/versions"
        className="group inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-accent"
      >
        <span className="transition-transform group-hover:-translate-x-0.5">←</span>
        Version Manager
      </Link>

      <ScreenDesc>
        Compare DR, format and quality across every pressing of this album in your library, and set
        your preferred version. ⚠ marks a loudness-war casualty — a pressing whose average DR dropped
        by {LOUDNESS_WAR_DR_DROP}+ points from an earlier pressing of the same album.
      </ScreenDesc>

      <CanvasPanel
        title="Crest-factor gauge wall"
        subtitle={`${album.name} · ${versions.length} pressing${versions.length === 1 ? '' : 's'} · needle = live DR${
          lwFlagged.size > 0 ? ', red arc = loudness war' : ''
        }`}
        height={250}
        background="linear-gradient(180deg,#141419,#0a0a0c)"
        draw={drawGaugeWall}
      />

      {versions.length > 0 && (
        <NoteBox
          notes={[
            hasExplicitPreferred
              ? 'A version has been explicitly marked preferred — it overrides the default recommendation below.'
              : `No version has been explicitly set as preferred yet, so the highest-DR pressing (${formatLabel(
                  versions[0]
                )}) is shown as the default recommendation.`,
          ]}
        />
      )}

      <DataTable
        title={`${album.name} — ${album.artist_name} · ${versions.length} version${versions.length === 1 ? '' : 's'}`}
        titleColor={C.vio}
        cols={[
          col('', 'center'),
          col('Year'),
          col('Format'),
          col('DR'),
          col('Mastered by'),
          col('Flags', 'center'),
        ]}
        rows={rows}
      />
    </div>
  )
}
