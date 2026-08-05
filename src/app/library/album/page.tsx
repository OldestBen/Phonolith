'use client'

/**
 * A real album view — hero art/metadata plus a disc-grouped tracklist —
 * replacing the old behaviour where clicking an album tile just re-filtered
 * the flat Files table (same generic columns, no art, no album-level
 * context) rather than landing anywhere that felt like "an album."
 *
 * Reachable either by a stable numeric `?id=` (albums.id, for albums
 * matched via Genius/MusicBrainz — preferred) or by `?artist=&album=` for
 * albums with no match at all. Both are resolved server-side by
 * /api/library/album using the same canonical/normalized grouping as the
 * Albums grid, so this always shows the complete, correctly-merged track
 * list rather than whatever subset happens to share identical raw tags.
 */

import { Fragment, Suspense, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LibraryFile } from '@/lib/types'
import { useBrowserPlayer } from '@/contexts/BrowserPlayerContext'
import { useAnalysisQueue } from '@/hooks/useAnalysisQueue'
import BulkActionBar from '@/components/BulkActionBar'

interface AlbumDetail {
  album_id: number | null
  album: string
  artist: string
  year: string | null
  cover_hash: string | null
  has_cover: boolean
  files: LibraryFile[]
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function formatFormat(file: LibraryFile): string {
  const parts = [file.format?.toUpperCase()]
  if (file.bit_depth && file.sample_rate) {
    parts.push(`${file.bit_depth}/${Math.round(file.sample_rate / 1000)}`)
  }
  return parts.filter(Boolean).join(' ')
}

function formatDuration(ms?: number): string {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

interface DiscGroup {
  disc_number: number
  files: LibraryFile[]
}

function groupByDisc(files: LibraryFile[]): DiscGroup[] {
  const groups = new Map<number, LibraryFile[]>()
  for (const f of files) {
    const disc = f.disc_number ?? 1
    if (!groups.has(disc)) groups.set(disc, [])
    groups.get(disc)!.push(f)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([disc_number, discFiles]) => ({ disc_number, files: discFiles }))
}

function TrackRow({
  file,
  selected,
  onToggle,
}: {
  file: LibraryFile
  selected: boolean
  onToggle: () => void
}) {
  const player = useBrowserPlayer()
  const isPlaying = player.currentHash === file.blake3_hash && player.isPlaying
  const detailHref = file.song_id ? `/song/${file.song_id}` : `/library/${file.blake3_hash}`

  return (
    <tr className="border-b border-border/50 hover:bg-surface-2 transition-colors group">
      <td className="py-2 pl-2 pr-1 w-8" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="w-3.5 h-3.5 accent-accent cursor-pointer"
        />
      </td>
      <td className="py-2 pr-2 w-8" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => isPlaying ? player.pause() : player.playQueue([file.blake3_hash])}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
          title={isPlaying ? 'Pause' : 'Play in browser'}
        >
          {isPlaying
            ? <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          }
        </button>
      </td>
      <td className="py-2.5 pr-3 text-text-muted text-xs w-8 text-right font-mono">
        {file.track_number ?? '—'}
      </td>
      <td className="py-2.5 pr-4">
        <Link href={detailHref} className="text-sm text-text-primary hover:text-accent transition-colors">
          {file.song_title || file.title || basename(file.file_path)}
        </Link>
        {file.song_artist && file.song_artist !== file.artist && (
          <span className="ml-1.5 text-xs text-text-muted">— {file.song_artist}</span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-text-muted text-xs">{formatFormat(file) || '—'}</td>
      <td className="py-2.5 pr-4 font-mono text-xs">
        {file.dr_score == null
          ? <span className="text-text-muted">—</span>
          : <span className={file.dr_score > 12 ? 'text-success' : file.dr_score >= 8 ? 'text-warning' : 'text-danger'}>{file.dr_score}</span>
        }
      </td>
      <td className="py-2.5 pr-4 text-text-muted text-xs font-mono">{formatDuration(file.duration_ms)}</td>
      <td className="py-2.5 pr-2 text-right" onClick={e => e.stopPropagation()}>
        <Link href={detailHref} className="text-xs text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
          Details →
        </Link>
      </td>
    </tr>
  )
}

function AlbumViewInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const artist = searchParams.get('artist')
  const album = searchParams.get('album')

  const [detail, setDetail] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const queue = useAnalysisQueue()

  useEffect(() => {
    setLoading(true)
    setError(null)
    const qs = id
      ? `id=${encodeURIComponent(id)}`
      : artist && album
      ? `artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
      : null
    if (!qs) {
      setError('No album specified.')
      setLoading(false)
      return
    }
    fetch(`/api/library/album?${qs}`)
      .then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => null)
          throw new Error(data?.error || 'Album not found.')
        }
        return r.json()
      })
      .then(setDetail)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, artist, album])

  const discGroups = useMemo(() => detail ? groupByDisc(detail.files) : [], [detail])
  const showDiscHeaders = discGroups.length > 1

  const allHashes = useMemo(() => detail?.files.map(f => f.blake3_hash) ?? [], [detail])
  const allSelected = allHashes.length > 0 && allHashes.every(h => queue.selected.has(h))

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-8 pb-20 md:pb-8">
        <div className="animate-pulse space-y-4">
          <div className="h-40 w-40 bg-surface-2 rounded-xl" />
          <div className="h-6 w-64 bg-surface-2 rounded" />
          <div className="h-4 w-40 bg-surface-2 rounded" />
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen px-4 py-8 pb-20 md:pb-8 flex flex-col items-center justify-center text-center">
        <p className="text-text-primary text-base mb-2">{error ?? 'Album not found.'}</p>
        <button onClick={() => router.push('/library')} className="text-accent text-sm hover:underline">
          ← Back to Library
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8 pb-28 md:pb-8">
      <button
        onClick={() => router.push('/library')}
        className="text-text-muted text-xs hover:text-text-primary transition-colors mb-4 inline-block"
      >
        ← Back to Library
      </button>

      <div className="flex flex-col sm:flex-row gap-5 mb-8">
        <div className="w-40 h-40 shrink-0 rounded-xl overflow-hidden bg-surface-2 border border-border">
          {detail.has_cover && detail.cover_hash && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/library/${detail.cover_hash}/cover`}
              alt={detail.album}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted">
              <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 opacity-50">
                <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end">
          <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Album</p>
          <h1 className="text-text-primary text-2xl font-bold mb-1.5">{detail.album}</h1>
          <Link
            href={`/library?artist=${encodeURIComponent(detail.artist)}`}
            className="text-text-muted text-sm hover:text-accent transition-colors w-fit"
          >
            {detail.artist}
          </Link>
          <p className="text-text-muted text-xs mt-1.5">
            {detail.year ? `${detail.year} · ` : ''}{detail.files.length} track{detail.files.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs">
              <th className="py-2 pl-2 pr-1 font-medium w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => queue.toggleMany(allHashes, !allSelected)}
                  className="w-3.5 h-3.5 accent-accent cursor-pointer"
                />
              </th>
              <th className="py-2 pr-2 font-medium w-8"></th>
              <th className="py-2 pr-3 font-medium text-right w-8">#</th>
              <th className="py-2 pr-4 font-medium">Title</th>
              <th className="py-2 pr-4 font-medium">Format</th>
              <th className="py-2 pr-4 font-medium">DR</th>
              <th className="py-2 pr-4 font-medium">Time</th>
              <th className="py-2 pr-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {discGroups.map(group => (
              <Fragment key={group.disc_number}>
                {showDiscHeaders && (
                  <tr>
                    <td colSpan={8} className="pt-4 pb-1.5 text-text-muted text-xs font-medium uppercase tracking-wide">
                      Disc {group.disc_number}
                    </td>
                  </tr>
                )}
                {group.files.map(f => (
                  <TrackRow
                    key={f.blake3_hash}
                    file={f}
                    selected={queue.selected.has(f.blake3_hash)}
                    onToggle={() => queue.toggle(f.blake3_hash)}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <BulkActionBar
        count={queue.total}
        queueState={queue.queueState}
        queued={queue.queued}
        failed={queue.failed}
        onQueue={queue.queueAnalysis}
        onClear={queue.clear}
      />
    </div>
  )
}

export default function AlbumViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-4 py-8 text-text-muted text-sm">Loading…</div>}>
      <AlbumViewInner />
    </Suspense>
  )
}
