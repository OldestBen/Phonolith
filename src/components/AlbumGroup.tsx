import Image from 'next/image'
import SongRow from './SongRow'
import type { Tag } from '@/lib/types'

interface SongItem {
  id: number
  genius_id: number
  title: string
  release_date?: string
  song_art_image_url?: string
  tags?: Tag[]
}

interface AlbumGroupProps {
  name: string
  coverArtUrl?: string
  releaseYear?: number
  songs: SongItem[]
}

export default function AlbumGroup({ name, coverArtUrl, releaseYear, songs }: AlbumGroupProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border">
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-2 flex-shrink-0">
          {coverArtUrl ? (
            <Image src={coverArtUrl} alt={name} width={48} height={48} className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted text-xl">♫</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text-primary truncate">{name}</p>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            {releaseYear && <span>{releaseYear}</span>}
            <span>{songs.length} {songs.length === 1 ? 'track' : 'tracks'}</span>
          </div>
        </div>
      </div>
      <div className="space-y-0.5">
        {songs.map((song, idx) => (
          <SongRow
            key={song.id}
            id={song.id}
            geniusId={song.genius_id}
            title={song.title}
            releaseDate={song.release_date}
            songArtUrl={song.song_art_image_url}
            trackNumber={idx + 1}
            tags={song.tags}
          />
        ))}
      </div>
    </div>
  )
}
