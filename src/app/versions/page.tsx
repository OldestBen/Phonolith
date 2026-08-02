'use client'

/**
 * Version Manager — landing list (matches the Claude Design mockup's
 * `P.versions` screen). Lists every album with multiple distinct pressings
 * in the library (GET /api/versions) as a card grid; each card links to the
 * per-album comparison view.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { ScreenDesc, CardGrid, drColor, type CardSpec } from '@/components/panel'

interface AlbumVersionSummary {
  album_id: number
  album_name: string
  artist_name: string
  cover_art_url: string | null
  release_date: string | null
  file_count: number
  dr_min: number | null
  dr_max: number | null
  formats: string[]
}

export default function VersionsPage() {
  const [albums, setAlbums] = useState<AlbumVersionSummary[] | null>(null)

  useEffect(() => {
    fetch('/api/versions')
      .then(r => (r.ok ? r.json() : []))
      .then(setAlbums)
      .catch(() => setAlbums([]))
  }, [])

  usePageHeader(
    'Version Manager',
    albums ? `${albums.length} album${albums.length === 1 ? '' : 's'} with multiple pressings` : 'loading…'
  )

  const cards: (CardSpec & { album_id: number })[] = (albums ?? []).map(a => ({
    album_id: a.album_id,
    title: a.album_name,
    sub: a.artist_name,
    badge: `${a.file_count} version${a.file_count === 1 ? '' : 's'}`,
    badgeColor: '#a78bfa',
    pills: a.formats.map(f => f.toUpperCase()),
    bar: a.dr_max != null ? Math.max(0, Math.min(100, (a.dr_max / 20) * 100)) : undefined,
    barColor: a.dr_max != null ? drColor(a.dr_max) : undefined,
    barLabel: a.dr_max != null ? `DR${a.dr_max}` : undefined,
  }))

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[13px] px-6 py-6">
      <ScreenDesc>
        Albums with multiple pressings in your library — compare DR, format and quality, and set your
        preferred version. Only albums with more than one distinct file per song are shown.
      </ScreenDesc>

      {albums == null ? (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-6 text-center">
          <p className="m-0 text-sm text-text-muted">Loading version comparisons…</p>
        </div>
      ) : cards.length > 0 ? (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {cards.map(c => (
            <Link key={c.album_id} href={`/versions/${c.album_id}`} className="block">
              <CardGrid cards={[c]} columns={false} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-6 text-center">
          <p className="m-0 text-sm text-text-muted">No version comparisons available yet.</p>
          <p className="mt-1 text-xs text-text-ghost">
            This page shows albums where your library contains multiple files for the same song,
            indicating different masters, pressings, or formats. Scan more sources to populate it.
          </p>
        </div>
      )}
    </div>
  )
}
