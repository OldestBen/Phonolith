'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { decadeOf } from '@/components/ArtistViz'
import LibraryGalaxy, { type Granularity } from '@/components/LibraryGalaxy'
import LibraryGalaxyControls, { type FocusInfo } from '@/components/LibraryGalaxyControls'
import type { GalaxyArtistNode } from '@/app/api/visualize/galaxy/artists/route'
import type { LibrarySongNode } from '@/app/api/visualize/galaxy/songs/route'

interface ArtistHit {
  id: number
  name: string
  image_url: string | null
}

interface ArtistGalaxyResponse {
  artists: GalaxyArtistNode[]
  edges: { collaborator: [number, number][]; producer: [number, number][] }
}

interface SongGalaxyResponse {
  songs: LibrarySongNode[]
  edges: { collaborator: [number, number][]; producer: [number, number][]; era: [number, number][] }
  total_song_count: number
  limit: number
}

function yearOf(date?: string): number | null {
  if (!date) return null
  const y = new Date(date).getFullYear()
  return Number.isNaN(y) ? null : y
}

export default function VisualizeLandingPage() {
  const router = useRouter()

  // ── Existing artist search — unchanged behaviour ──────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ArtistHit[]>([])
  const [recent, setRecent] = useState<ArtistHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.ok ? r.json() : [])
      .then((events: Array<{ artist_id: number; artist_name: string; artist_image: string | null }>) => {
        const seen = new Set<number>()
        const unique: ArtistHit[] = []
        for (const e of events) {
          if (e.artist_id && !seen.has(e.artist_id)) {
            seen.add(e.artist_id)
            unique.push({ id: e.artist_id, name: e.artist_name, image_url: e.artist_image })
          }
        }
        setRecent(unique.slice(0, 8))
      })
      .catch(() => {})
  }, [])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (r.ok) setResults(await r.json())
    } catch {}
    setSearching(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 300)
    return () => clearTimeout(t)
  }, [query, search])

  const displayList = query.trim() ? results : recent
  const searchActive = query.trim().length > 0

  // ── New: library-wide galaxy (default view when no search is active) ─────
  const [granularity, setGranularity] = useState<Granularity>('artists')
  const [artistData, setArtistData] = useState<ArtistGalaxyResponse | null>(null)
  const [songData, setSongData] = useState<SongGalaxyResponse | null>(null)
  const [loadingArtists, setLoadingArtists] = useState(true)
  const [loadingSongs, setLoadingSongs] = useState(false)

  const [showCollaborator, setShowCollaborator] = useState(true)
  const [showProducer, setShowProducer] = useState(true)
  const [showEra, setShowEra] = useState(false)
  const [decadeFilter, setDecadeFilter] = useState('all')
  const [zoom, setZoom] = useState(1)
  const [selectedArtist, setSelectedArtist] = useState<GalaxyArtistNode | null>(null)
  const [selectedSong, setSelectedSong] = useState<LibrarySongNode | null>(null)

  // Artist-cluster data is cheap (see the route's own comment) so it's
  // always fetched up front — it's also the default granularity.
  useEffect(() => {
    let cancelled = false
    setLoadingArtists(true)
    fetch('/api/visualize/galaxy/artists')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setArtistData(data) })
      .catch(() => { if (!cancelled) setArtistData(null) })
      .finally(() => { if (!cancelled) setLoadingArtists(false) })
    return () => { cancelled = true }
  }, [])

  // Per-song data is the expensive mode — only fetched the first time the
  // user actually switches to it, not eagerly on page load.
  //
  // Dependency array is deliberately just [granularity], NOT
  // [granularity, songData, loadingSongs]: this effect is what SETS
  // songData/loadingSongs, so including them re-triggers the effect (cleanup
  // then re-run) on the very next render after setLoadingSongs(true) —
  // before the fetch has resolved. That cleanup sets `cancelled = true` for
  // the in-flight request's closure, so its .then/.finally handlers become
  // no-ops when the response does arrive: loadingSongs is stuck true and
  // "All Songs" mode never leaves its loading state. Verified live — this
  // exact bug reproduced as a permanently-stuck "Loading library galaxy…"
  // screen. Guard checks below still prevent duplicate fetches; they just
  // don't need to be in the dependency array to do that.
  useEffect(() => {
    if (granularity !== 'songs' || songData || loadingSongs) return
    let cancelled = false
    setLoadingSongs(true)
    fetch('/api/visualize/galaxy/songs')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setSongData(data) })
      .catch(() => { if (!cancelled) setSongData(null) })
      .finally(() => { if (!cancelled) setLoadingSongs(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity])

  useEffect(() => {
    setSelectedArtist(null)
    setSelectedSong(null)
  }, [granularity])

  const filteredSongs = useMemo(() => {
    if (!songData) return []
    return decadeFilter === 'all'
      ? songData.songs
      : songData.songs.filter(s => decadeOf(s.release_date) === decadeFilter)
  }, [songData, decadeFilter])

  const decades = useMemo(() => {
    if (!songData) return []
    const set = new Set<string>()
    for (const s of songData.songs) {
      const d = decadeOf(s.release_date)
      if (d) set.add(d)
    }
    return Array.from(set).sort()
  }, [songData])

  const edgeCounts = useMemo(() => {
    if (granularity === 'artists') {
      return {
        collaborator: artistData?.edges.collaborator.length ?? 0,
        producer: artistData?.edges.producer.length ?? 0,
      }
    }
    return {
      collaborator: songData?.edges.collaborator.length ?? 0,
      producer: songData?.edges.producer.length ?? 0,
      era: songData?.edges.era.length ?? 0,
    }
  }, [granularity, artistData, songData])

  const focus: FocusInfo | null = useMemo(() => {
    if (granularity === 'artists' && selectedArtist) {
      return {
        title: selectedArtist.name,
        subtitle: `${selectedArtist.song_count.toLocaleString()} indexed song${selectedArtist.song_count === 1 ? '' : 's'}`,
        rows: [
          { k: 'Owned (matched files)', v: selectedArtist.owned_count.toLocaleString() },
          { k: 'Indexed songs', v: selectedArtist.song_count.toLocaleString() },
          { k: 'Double-click', v: 'Open artist galaxy' },
        ],
      }
    }
    if (granularity === 'songs' && selectedSong) {
      return {
        title: selectedSong.title,
        subtitle: `${selectedSong.artist_name} · ${yearOf(selectedSong.release_date) ?? '—'}`,
        rows: [
          { k: 'Album', v: selectedSong.album_name ?? 'Singles' },
          { k: 'Pageviews', v: (selectedSong.pageviews ?? 0).toLocaleString() },
          { k: 'Double-click', v: 'Open song' },
        ],
      }
    }
    return null
  }, [granularity, selectedArtist, selectedSong])

  const galaxyLoading = granularity === 'artists' ? loadingArtists : loadingSongs

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-4 max-w-xl">
        <h1 className="text-text-primary text-xl font-bold mb-1">Visualize</h1>
        <p className="text-text-muted text-xs mb-3">
          Search for an artist to drill into their discography, or explore the whole library below as a galaxy.
        </p>
        <div className="relative">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search for an artist…"
            className="w-full bg-surface border border-border text-text-primary rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:border-accent transition-colors"
          />
          {searching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>

      {searchActive ? (
        <div className="max-w-xl">
          {displayList.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {displayList.map(artist => (
                <Link
                  key={artist.id}
                  href={`/visualize/${artist.id}`}
                  className="group flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-3 hover:border-accent/50 hover:bg-surface-2 transition-all"
                >
                  {artist.image_url ? (
                    <img src={artist.image_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                      <span className="text-accent font-bold text-sm">{artist.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <span className="text-text-primary text-sm font-medium truncate group-hover:text-accent transition-colors">
                    {artist.name}
                  </span>
                  <svg className="ml-auto w-4 h-4 text-text-muted shrink-0 group-hover:text-accent transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          ) : (
            !searching && <p className="text-text-muted text-sm text-center py-8">No artists found for &quot;{query}&quot;</p>
          )}
        </div>
      ) : (
        <>
          {recent.length > 0 && (
            <div className="mb-4">
              <p className="text-text-muted text-xs uppercase tracking-widest mb-2">Recently explored</p>
              <div className="flex flex-wrap gap-2">
                {recent.map(artist => (
                  <Link
                    key={artist.id}
                    href={`/visualize/${artist.id}`}
                    className="group flex items-center gap-2 bg-surface border border-border rounded-full pl-1.5 pr-3 py-1 hover:border-accent/50 hover:bg-surface-2 transition-all"
                  >
                    {artist.image_url ? (
                      <img src={artist.image_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                        <span className="text-accent font-bold text-[10px]">{artist.name.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <span className="text-text-primary text-xs font-medium truncate group-hover:text-accent transition-colors">
                      {artist.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 items-start" style={{ gridTemplateColumns: '212px minmax(0,1fr)' }}>
            <LibraryGalaxyControls
              granularity={granularity}
              showCollaborator={showCollaborator}
              showProducer={showProducer}
              showEra={showEra}
              onToggle={key => {
                if (key === 'showCollaborator') setShowCollaborator(v => !v)
                if (key === 'showProducer') setShowProducer(v => !v)
                if (key === 'showEra') setShowEra(v => !v)
              }}
              edgeCounts={edgeCounts}
              decades={decades}
              decadeFilter={decadeFilter}
              onDecadeChange={setDecadeFilter}
              zoom={zoom}
              focus={focus}
              songCap={songData ? { shown: songData.songs.length, total: songData.total_song_count } : undefined}
            />

            <div className="relative">
              <div
                className="relative overflow-hidden rounded-[10px] border border-border"
                style={{
                  background: 'radial-gradient(circle at 50% 45%, #141021 0%, #0b0b0f 62%)',
                  height: 'calc(100vh - 260px)',
                  minHeight: 420,
                }}
              >
                {galaxyLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-text-muted text-sm animate-pulse">Loading library galaxy…</div>
                  </div>
                ) : granularity === 'artists' && !artistData ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-text-muted text-sm">Couldn&apos;t load the library galaxy.</div>
                  </div>
                ) : granularity === 'songs' && !songData ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-text-muted text-sm">Couldn&apos;t load the library galaxy.</div>
                  </div>
                ) : (
                  <LibraryGalaxy
                    granularity={granularity}
                    artists={artistData?.artists ?? []}
                    songs={filteredSongs}
                    edges={
                      granularity === 'artists'
                        ? { collaborator: artistData?.edges.collaborator ?? [], producer: artistData?.edges.producer ?? [] }
                        : { collaborator: songData?.edges.collaborator ?? [], producer: songData?.edges.producer ?? [], era: songData?.edges.era ?? [] }
                    }
                    filters={{ showCollaborator, showProducer, showEra }}
                    onArtistSelect={setSelectedArtist}
                    onArtistOpen={artist => router.push(`/visualize/${artist.genius_id}`)}
                    onSongSelect={setSelectedSong}
                    onSongOpen={song => router.push(`/song/${song.genius_id}`)}
                    onZoomChange={setZoom}
                  />
                )}

                {/* Granularity switch — the mockup's galaxyViews button style,
                    reused verbatim (see ArtistViz.tsx's VIEW_MODES row).
                    Galaxy/Timeline/Swim-lanes aren't offered here: Timeline and
                    Swim-lanes lay out one artist's own release history and
                    don't generalize to a whole library (see the Focus panel
                    note), and Galaxy is the only layout this screen renders. */}
                <div className="absolute right-3.5 bottom-3 flex gap-1.5">
                  {([
                    { key: 'artists' as Granularity, label: 'Artists' },
                    { key: 'songs' as Granularity, label: 'All Songs' },
                  ]).map(({ key, label }) => {
                    const on = granularity === key
                    return (
                      <button
                        key={key}
                        onClick={() => setGranularity(key)}
                        className="rounded-md px-2.5 py-[3px] text-[10px] font-medium transition-colors"
                        style={{
                          border: `1px solid ${on ? '#7c3aed' : '#27272a'}`,
                          background: on ? 'rgba(109,40,217,.3)' : 'rgba(16,16,18,.8)',
                          color: on ? '#c4b5fd' : '#a1a1aa',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
