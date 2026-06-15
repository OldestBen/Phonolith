'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

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

function DrRange({ min, max }: { min: number | null; max: number | null }) {
  if (min == null && max == null) return <span className="text-text-muted">—</span>
  if (min === max) {
    const color = (max ?? 0) > 12 ? 'text-success' : (max ?? 0) >= 8 ? 'text-warning' : 'text-danger'
    return <span className={`font-mono text-sm ${color}`}>{max}</span>
  }
  return (
    <span className="font-mono text-sm">
      <span className={(min ?? 0) >= 8 ? 'text-success' : 'text-danger'}>{min}</span>
      <span className="text-text-muted mx-1">–</span>
      <span className={(max ?? 0) > 12 ? 'text-success' : 'text-warning'}>{max}</span>
    </span>
  )
}

export default function VersionsPage() {
  const [albums, setAlbums] = useState<AlbumVersionSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/versions')
      .then(r => r.ok ? r.json() : [])
      .then(setAlbums)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen px-4 py-8 pb-20 md:pb-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-text-primary text-xl font-bold">Version Comparison</h1>
          <p className="text-text-muted text-sm mt-1">
            Albums with multiple versions in your library — compare masters, pressings, and formats side by side.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-surface-2 rounded-xl" />
            ))}
          </div>
        ) : albums.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-text-muted text-base mb-2">No version comparisons available yet.</p>
            <p className="text-text-muted text-sm">
              This page shows albums where your library contains multiple files for the same song,
              indicating different masters, pressings, or formats. Scan more sources to populate it.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {albums.map(album => (
              <Link
                key={album.album_id}
                href={`/versions/${album.album_id}`}
                className="group flex items-center gap-4 bg-surface border border-border rounded-xl px-4 py-3
                           hover:border-accent/40 hover:bg-surface-2 transition-all"
              >
                {album.cover_art_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={album.cover_art_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-accent/20 shrink-0 flex items-center justify-center">
                    <span className="text-accent text-xs font-bold">{album.album_name.charAt(0)}</span>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-sm font-medium truncate group-hover:text-accent transition-colors">
                    {album.album_name}
                  </p>
                  <p className="text-text-muted text-xs truncate">
                    {album.artist_name}
                    {album.release_date && ` · ${album.release_date.slice(0, 4)}`}
                  </p>
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-text-muted text-[10px] uppercase tracking-widest mb-0.5">DR range</p>
                    <DrRange min={album.dr_min} max={album.dr_max} />
                  </div>
                  <div className="text-right hidden md:block">
                    <p className="text-text-muted text-[10px] uppercase tracking-widest mb-0.5">Formats</p>
                    <p className="text-text-primary text-xs font-mono">
                      {album.formats.map(f => f.toUpperCase()).join(', ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-text-muted text-[10px] uppercase tracking-widest mb-0.5">Versions</p>
                    <p className="text-accent text-sm font-mono font-bold">{album.file_count}</p>
                  </div>
                  <svg className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
