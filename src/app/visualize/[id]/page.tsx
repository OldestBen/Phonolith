'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Artist, VizConnections } from '@/lib/types'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import ArtistViz, { decadeOf, type SongData, type VizFilters } from '@/components/ArtistViz'
import VizControls, { type FocusInfo } from '@/components/VizControls'

function yearOf(date?: string): number | null {
  if (!date) return null
  const y = new Date(date).getFullYear()
  return Number.isNaN(y) ? null : y
}

export default function VisualizePage() {
  const { id } = useParams<{ id: string }>()
  const [artist, setArtist] = useState<Artist | null>(null)
  const [songs, setSongs] = useState<SongData[]>([])
  const [connections, setConnections] = useState<VizConnections | null>(null)
  const [loading, setLoading] = useState(true)

  const [filters, setFilters] = useState<VizFilters>({
    showCollaborator: true,
    showProducer: true,
    showEra: false,
    decadeFilter: 'all',
    viewMode: 'galaxy',
  })
  const [selectedSong, setSelectedSong] = useState<SongData | null>(null)
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [artistRes, songsRes, connRes] = await Promise.all([
          fetch(`/api/artist/${id}`),
          fetch(`/api/visualize/${id}`),
          fetch(`/api/visualize/${id}/connections`),
        ])
        if (cancelled) return
        // Each of these routes returns its payload bare (no wrapper object) —
        // see /api/artist/[id], /api/visualize/[id], and its /connections route.
        if (artistRes.ok) setArtist(await artistRes.json())
        if (songsRes.ok) setSongs(await songsRes.json())
        if (connRes.ok) setConnections(await connRes.json())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  // Reset selection when the artist changes so stale focus data can't leak across pages
  useEffect(() => {
    setSelectedSong(null)
    setSelectedAlbumName(null)
  }, [id])

  const decades = useMemo(() => {
    const set = new Set<string>()
    for (const s of songs) {
      const d = decadeOf(s.release_date)
      if (d) set.add(d)
    }
    return Array.from(set).sort()
  }, [songs])

  const edgeCounts = useMemo(() => ({
    collaborator: connections?.collaborator.length ?? 0,
    producer: connections?.producer.length ?? 0,
    era: connections?.era.length ?? 0,
  }), [connections])

  const focus: FocusInfo | null = useMemo(() => {
    const artistName = artist?.name ?? 'Unknown artist'

    if (selectedSong) {
      // Real per-song counts, derived from the same collaborator/era edge
      // lists the overlays draw from — not fabricated.
      const collabCount = connections?.collaborator.filter(([a, b]) => a === selectedSong.id || b === selectedSong.id).length ?? 0
      const eraCount = connections?.era.filter(([a, b]) => a === selectedSong.id || b === selectedSong.id).length ?? 0
      return {
        title: selectedSong.title,
        subtitle: `${artistName} · ${yearOf(selectedSong.release_date) ?? '—'}`,
        rows: [
          { k: 'Album', v: selectedSong.album_name ?? 'Singles' },
          { k: 'Pageviews', v: (selectedSong.pageviews ?? 0).toLocaleString() },
          { k: 'Released', v: selectedSong.release_date ? new Date(selectedSong.release_date).toLocaleDateString() : '—' },
          { k: 'Collaborators', v: String(collabCount) },
          { k: 'Era peers', v: String(eraCount) },
        ],
      }
    }

    if (selectedAlbumName) {
      const albumSongs = songs.filter(s => (s.album_name ?? 'Singles') === selectedAlbumName)
      const years = albumSongs.map(s => yearOf(s.release_date)).filter((y): y is number => y !== null)
      const yearLabel = years.length
        ? (Math.min(...years) === Math.max(...years) ? String(Math.min(...years)) : `${Math.min(...years)}–${Math.max(...years)}`)
        : '—'
      const totalViews = albumSongs.reduce((sum, s) => sum + (s.pageviews ?? 0), 0)
      return {
        title: selectedAlbumName,
        subtitle: `${artistName} · ${yearLabel} · ${albumSongs.length} song${albumSongs.length === 1 ? '' : 's'}`,
        rows: [
          { k: 'Songs', v: String(albumSongs.length) },
          { k: 'Span', v: yearLabel },
          { k: 'Total pageviews', v: totalViews.toLocaleString() },
        ],
      }
    }

    return null
  }, [selectedSong, selectedAlbumName, songs, artist, connections])

  usePageHeader(
    artist?.name ?? 'Galaxy',
    songs.length ? `${songs.length} song${songs.length === 1 ? '' : 's'} · ${edgeCounts.collaborator + edgeCounts.producer + edgeCounts.era} edges` : ''
  )

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-3">
        <Link
          href={`/artist/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          ← Back to artist
        </Link>
      </div>

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: '212px minmax(0,1fr)' }}>
        <VizControls
          filters={filters}
          onFiltersChange={setFilters}
          edgeCounts={edgeCounts}
          decades={decades}
          zoom={zoom}
          focus={focus}
        />

        <div
          className="relative overflow-hidden rounded-[10px] border border-border"
          style={{
            background: 'radial-gradient(circle at 50% 45%, #141021 0%, #0b0b0f 62%)',
            height: 'calc(100vh - 190px)',
            minHeight: 420,
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-text-muted text-sm animate-pulse">Loading visualization…</div>
            </div>
          ) : connections ? (
            <ArtistViz
              songs={songs}
              connections={connections}
              filters={filters}
              onSongSelect={setSelectedSong}
              onAlbumSelect={setSelectedAlbumName}
              onZoomChange={setZoom}
              onViewModeChange={mode => setFilters(f => ({ ...f, viewMode: mode }))}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-text-muted text-sm">Couldn&apos;t load this artist&apos;s connections.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
