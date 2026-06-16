'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AlbumSummary } from '@/lib/types'

function MusicNotePlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center text-text-muted">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 opacity-50">
        <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export default function AlbumTile({ album, artist, year, track_count, cover_hash, has_cover }: AlbumSummary) {
  const [imgError, setImgError] = useState(false)
  const showImage = has_cover && cover_hash && !imgError

  return (
    <Link
      href={`/library?album=${encodeURIComponent(album)}&artist=${encodeURIComponent(artist)}`}
      className="group block rounded-xl border border-border bg-surface card-hover overflow-hidden"
    >
      <div className="aspect-square relative overflow-hidden bg-surface-2">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/library/${cover_hash}/cover`}
            alt={album}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <MusicNotePlaceholder />
        )}
        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-background/80 border border-border text-text-muted text-xs">
          {track_count} track{track_count !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm text-text-primary truncate">{album}</p>
        <p className="text-xs text-text-muted truncate mt-0.5">
          {artist}{year ? ` · ${year}` : ''}
        </p>
      </div>
    </Link>
  )
}
