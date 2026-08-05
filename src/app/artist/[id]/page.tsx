'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Artist, Song, Tag } from '@/lib/types'

// ── Tag badge ───────────────────────────────────────────────────────────────
function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: tag.color + '33', color: tag.color, border: `1px solid ${tag.color}55` }}
    >
      {tag.name}
    </span>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function HeroSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-56 bg-surface-2 w-full mb-6" />
      <div className="h-8 bg-surface-2 rounded w-48 mx-6 mb-2" />
      <div className="h-4 bg-surface-2 rounded w-32 mx-6" />
    </div>
  )
}

function AlbumGroupSkeleton() {
  return (
    <div className="animate-pulse mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 bg-surface-2 rounded" />
        <div>
          <div className="h-5 bg-surface-2 rounded w-40 mb-1" />
          <div className="h-3 bg-surface-2 rounded w-20" />
        </div>
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} className="h-10 bg-surface-2 rounded mb-1" />
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatYear(date?: string) {
  if (!date) return '—'
  return date.slice(0, 4)
}

function formatFollowers(n?: number) {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M followers`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K followers`
  return `${n} followers`
}

// ── Song row ─────────────────────────────────────────────────────────────────
function SongRow({
  song,
  trackNumber,
  showTrackNum,
}: {
  song: Song
  trackNumber?: number
  showTrackNum?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 group transition-colors">
      {showTrackNum && (
        <span className="text-text-muted text-xs w-5 text-right shrink-0">{trackNumber ?? '–'}</span>
      )}
      {song.song_art_image_url ? (
        <div className="relative w-8 h-8 shrink-0 rounded overflow-hidden">
          <Image
            src={song.song_art_image_url}
            alt={song.title}
            fill
            className="object-cover"
            sizes="32px"
          />
        </div>
      ) : (
        <div className="w-8 h-8 shrink-0 rounded bg-surface-2 flex items-center justify-center text-text-muted text-xs">
          ♪
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-sm font-medium truncate">{song.title}</p>
      </div>
      <span className="text-text-muted text-xs shrink-0">{formatYear(song.release_date)}</span>
      {song.tags && song.tags.length > 0 && (
        <div className="hidden sm:flex gap-1 shrink-0">
          {song.tags.slice(0, 2).map(t => <TagBadge key={t.id} tag={t} />)}
        </div>
      )}
      <Link
        href={`/song/${song.genius_id}`}
        className="shrink-0 text-xs text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
      >
        Lyrics →
      </Link>
    </div>
  )
}

// ── Album group ───────────────────────────────────────────────────────────────
interface AlbumGroup {
  name: string
  cover?: string
  earliestYear: string
  songs: Song[]
}

function AlbumSection({ group }: { group: AlbumGroup }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="mb-8">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 w-full text-left mb-2 group"
      >
        {group.cover ? (
          <div className="relative w-12 h-12 shrink-0 rounded overflow-hidden">
            <Image src={group.cover} alt={group.name} fill className="object-cover" sizes="48px" />
          </div>
        ) : (
          <div className="w-12 h-12 shrink-0 rounded bg-surface-2 flex items-center justify-center text-text-muted text-lg">
            ♫
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-text-primary font-semibold text-sm truncate">{group.name}</p>
          <p className="text-text-muted text-xs">
            {group.earliestYear !== '—' ? group.earliestYear : ''} · {group.songs.length} song{group.songs.length !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="text-text-muted text-xs ml-2">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pl-1">
          {group.songs.map((song, idx) => (
            <SongRow key={song.id} song={song} trackNumber={idx + 1} showTrackNum />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Download all lyrics helper ────────────────────────────────────────────────
async function downloadAllLyrics(songs: Song[], artistName: string) {
  const chunks: string[] = []
  for (const song of songs) {
    try {
      const r = await fetch(`/api/song/${song.genius_id}/lyrics`)
      if (r.ok) {
        const data = await r.json()
        chunks.push(`${'═'.repeat(60)}\n${song.title}\n${'═'.repeat(60)}\n\n${data.content ?? ''}\n\n`)
      }
    } catch {
      // skip
    }
  }
  const blob = new Blob([chunks.join('')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${artistName} - All Lyrics.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ArtistPage() {
  const { id } = useParams<{ id: string }>()

  const [artist, setArtist] = useState<Artist | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'albums' | 'songs'>('albums')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [artistRes, songsRes] = await Promise.all([
          fetch(`/api/artist/${id}`),
          fetch(`/api/artist/${id}/songs?all=true`),
        ])
        if (artistRes.ok) {
          const data = await artistRes.json()
          setArtist(data.artist ?? data)
        }
        if (songsRes.ok) {
          const data = await songsRes.json()
          setSongs(data.songs ?? data)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // Build album groups
  const albumGroups = useCallback((): AlbumGroup[] => {
    const map = new Map<string, Song[]>()
    for (const song of songs) {
      const key = song.album_name ?? '__singles__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(song)
    }
    const groups: AlbumGroup[] = []
    map.forEach((grpSongs, name) => {
      if (name === '__singles__') return
      const years = grpSongs.map(s => formatYear(s.release_date)).filter(y => y !== '—')
      groups.push({
        name,
        cover: grpSongs[0]?.album_cover_art_url,
        earliestYear: years.sort()[0] ?? '—',
        songs: grpSongs,
      })
    })
    // Sort by earliest year
    groups.sort((a, b) => {
      if (a.earliestYear === '—') return 1
      if (b.earliestYear === '—') return -1
      return a.earliestYear.localeCompare(b.earliestYear)
    })
    // Singles
    const singles = map.get('__singles__')
    if (singles && singles.length > 0) {
      groups.push({ name: 'Singles & Other', cover: undefined, earliestYear: '—', songs: singles })
    }
    return groups
  }, [songs])

  if (loading) {
    return (
      <div>
        <HeroSkeleton />
        <div className="max-w-4xl mx-auto px-4 pt-8">
          <AlbumGroupSkeleton />
          <AlbumGroupSkeleton />
          <AlbumGroupSkeleton />
        </div>
      </div>
    )
  }

  if (!artist) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted">Artist not found.</p>
      </div>
    )
  }

  const followers = formatFollowers(artist.followers)
  const groups = albumGroups()

  return (
    <div className="pb-20 md:pb-8">
      {/* Hero */}
      <div className="relative h-56 md:h-72 overflow-hidden bg-surface-2">
        {artist.image_url && (
          <>
            {/* Blurred background */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${artist.image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(20px)',
                transform: 'scale(1.1)',
              }}
            />
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-background/70" />
          </>
        )}
        <div className="absolute inset-0 flex flex-col justify-end px-6 pb-6">
          <h1 className="text-white text-3xl md:text-5xl font-bold drop-shadow-lg">{artist.name}</h1>
          {followers && <p className="text-white/70 text-sm mt-1">{followers}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            <Link
              href={`/visualize/${id}`}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 transition-colors"
            >
              Visualize
            </Link>
            <button
              onClick={async () => {
                setDownloading(true)
                await downloadAllLyrics(songs, artist.name)
                setDownloading(false)
              }}
              disabled={downloading || songs.length === 0}
              className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs font-medium
                         hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : 'Download All Lyrics'}
            </button>
            <Link
              href={`/artist/${id}/library`}
              className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs font-medium
                         hover:bg-surface-2 transition-colors"
            >
              View in Library
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 max-w-6xl mx-auto">
        {/* Main content */}
        <div className="flex-1 min-w-0 px-4 pt-6">
          {/* Toggle */}
          <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1 w-fit">
            <button
              onClick={() => setView('albums')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === 'albums' ? 'bg-surface-2 text-text-primary' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              By Album
            </button>
            <button
              onClick={() => setView('songs')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === 'songs' ? 'bg-surface-2 text-text-primary' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              All Songs
            </button>
          </div>

          {/* Content */}
          {view === 'albums' ? (
            <div>
              {groups.length === 0 ? (
                <p className="text-text-muted text-sm">No songs found.</p>
              ) : (
                groups.map(g => <AlbumSection key={g.name} group={g} />)
              )}
            </div>
          ) : (
            <div>
              {songs.length === 0 ? (
                <p className="text-text-muted text-sm">No songs found.</p>
              ) : (
                songs.map(song => <SongRow key={song.id} song={song} />)
              )}
            </div>
          )}
        </div>

        {/* Right aside */}
        {artist.description && (
          <aside className="hidden lg:block w-72 shrink-0 px-4 pt-6">
            <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">About</h2>
            <p className="text-text-muted text-sm leading-relaxed">{artist.description}</p>
          </aside>
        )}
      </div>
    </div>
  )
}
