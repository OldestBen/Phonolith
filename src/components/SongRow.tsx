import Image from 'next/image'
import Link from 'next/link'
import TagBadge from './TagBadge'
import type { Tag } from '@/lib/types'

interface SongRowProps {
  id: number
  geniusId: number
  title: string
  releaseDate?: string
  songArtUrl?: string
  trackNumber?: number
  tags?: Tag[]
}

export default function SongRow({ id: _id, geniusId, title, releaseDate, songArtUrl, trackNumber, tags }: SongRowProps) {
  const year = releaseDate ? new Date(releaseDate).getFullYear() : null

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors group">
      {trackNumber !== undefined && (
        <span className="w-6 text-right text-xs text-text-muted flex-shrink-0 tabular-nums">
          {trackNumber}
        </span>
      )}
      <div className="w-8 h-8 rounded overflow-hidden bg-surface-2 flex-shrink-0">
        {songArtUrl ? (
          <Image src={songArtUrl} alt={title} width={32} height={32} className="object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">♪</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{title}</p>
        {tags && tags.length > 0 && (
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {tags.map(t => <TagBadge key={t.id} name={t.name} color={t.color} variant="muted" />)}
          </div>
        )}
      </div>
      {year && <span className="text-xs text-text-muted flex-shrink-0">{year}</span>}
      <Link
        href={`/song/${geniusId}`}
        className="text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hover:underline"
      >
        Lyrics
      </Link>
    </div>
  )
}
