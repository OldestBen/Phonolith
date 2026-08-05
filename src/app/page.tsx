'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'

interface GeniusArtist {
  id: number
  genius_id: number
  name: string
  image_url?: string
}

interface RecentArtist {
  artist_name: string
  artist_id?: number
  genius_id?: number
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-square bg-surface-2 rounded-xl mb-2" />
      <div className="h-4 bg-surface-2 rounded w-3/4 mb-1" />
      <div className="h-3 bg-surface-2 rounded w-1/2" />
    </div>
  )
}

function HomePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialQ = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(initialQ)
  const [inputValue, setInputValue] = useState(initialQ)
  const [artists, setArtists] = useState<GeniusArtist[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(!!initialQ)
  const [recentArtists, setRecentArtists] = useState<RecentArtist[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch recent history on mount
  useEffect(() => {
    fetch('/api/history?limit=50')
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => {
        const events: Array<{ artist_name?: string; artist_id?: number }> = data.events ?? []
        const seen = new Set<string>()
        const recents: RecentArtist[] = []
        for (const e of events) {
          if (e.artist_name && !seen.has(e.artist_name)) {
            seen.add(e.artist_name)
            recents.push({ artist_name: e.artist_name, artist_id: e.artist_id })
            if (recents.length >= 5) break
          }
        }
        setRecentArtists(recents)
      })
      .catch(() => {})
  }, [])

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setArtists([])
      setSearched(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setSearched(true)
    // GET /api/search returns a bare array of artist hits, not { artists: [...] } —
    // same shape (and same historical bug) as the Galaxy search fixed earlier.
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setArtists(Array.isArray(data) ? data : [])
      })
      .catch(() => setArtists([]))
      .finally(() => setLoading(false))
  }, [])

  // Run search on initial load if q param present
  useEffect(() => {
    if (initialQ) doSearch(initialQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setQuery(val)
      doSearch(val)
    }, 300)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setQuery(inputValue)
    doSearch(inputValue)
  }

  const showHero = !searched && !loading

  return (
    <div className="min-h-screen px-4 pb-20 md:pb-4">
      {/* Hero / Search area */}
      <div className={`flex flex-col items-center ${showHero ? 'justify-center min-h-screen' : 'pt-12 pb-8'}`}>
        {showHero && (
          <>
            <h1 className="text-gradient text-5xl font-bold tracking-tight mb-4 font-sans">
              Phonolith
            </h1>
            <p className="text-text-muted text-lg mb-10 text-center max-w-md">
              Search artists. Browse their discography. Read every lyric.
            </p>
          </>
        )}

        <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
          <input
            type="text"
            value={inputValue}
            onChange={handleChange}
            placeholder="Search for an artist…"
            className="
              bg-surface border border-border focus:border-accent
              rounded-xl px-4 py-3 w-full
              text-text-primary placeholder:text-text-muted
              outline-none transition-colors duration-150
              text-base
            "
            autoFocus
          />
        </form>
      </div>

      {/* Results */}
      {(loading || searched) && (
        <div className="max-w-5xl mx-auto">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : artists.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {artists.map(artist => (
                <Link
                  key={artist.genius_id ?? artist.id}
                  href={`/artist/${artist.genius_id ?? artist.id}`}
                  className="group block"
                >
                  <div className="aspect-square relative rounded-xl overflow-hidden bg-surface-2 mb-2">
                    {artist.image_url ? (
                      <Image
                        src={artist.image_url}
                        alt={artist.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-200"
                        sizes="(max-width: 640px) 50vw, 25vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-text-muted text-4xl font-bold">
                        {artist.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <p className="text-text-primary font-medium truncate text-sm">{artist.name}</p>
                  <p className="text-text-muted text-xs mt-0.5 group-hover:text-accent transition-colors">
                    View discography →
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-text-muted text-base">
                No artists found for &ldquo;{query}&rdquo; — try different terms.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recently Explored */}
      {recentArtists.length > 0 && (
        <div className="max-w-5xl mx-auto mt-12">
          <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">
            Recently Explored
          </h2>
          <div className="flex flex-wrap gap-2">
            {recentArtists.map(r => (
              <Link
                key={r.artist_name}
                href={`/artist/${r.artist_id ?? ''}`}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-sm
                           hover:text-text-primary hover:border-accent/40 transition-colors duration-150"
              >
                {r.artist_name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-muted">Loading…</div>
      </div>
    }>
      <HomePageInner />
    </Suspense>
  )
}
