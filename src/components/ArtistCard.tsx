import Image from 'next/image'
import Link from 'next/link'

interface ArtistCardProps {
  id: number
  name: string
  image_url?: string
}

export default function ArtistCard({ id, name, image_url }: ArtistCardProps) {
  return (
    <Link
      href={`/artist/${id}`}
      className="group block rounded-xl border border-border bg-surface card-hover overflow-hidden"
    >
      <div className="aspect-square relative overflow-hidden bg-surface-2">
        {image_url ? (
          <Image
            src={image_url}
            alt={name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 50vw, 25vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-4xl">
            ♪
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm text-text-primary truncate">{name}</p>
        <p className="text-xs text-accent mt-0.5">View discography →</p>
      </div>
    </Link>
  )
}
