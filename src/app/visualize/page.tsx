'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface ArtistHit {
  id: number
  name: string
  image_url: string | null
}

export default function VisualizeLandingPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ArtistHit[]>([])
  const [recent, setRecent] = useState<ArtistHit[]>([])
  const [searching, setSearching] = useState(false)

  // Load recently viewed artists from history
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
      if (r.ok) setResults((await r.json()).artists ?? [])
    } catch {}
    setSearching(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 300)
    return () => clearTimeout(t)
  }, [query, search])

  const displayList = query.trim() ? results : recent

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 bg-background">
      <div className="w-full max-w-xl">
        <h1 className="text-text-primary text-3xl font-bold mb-2 text-center">Visualize</h1>
        <p className="text-text-muted text-sm text-center mb-8">
          Pick an artist to explore their discography as an interactive galaxy.
        </p>

        {/* Search */}
        <div className="relative mb-8">
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

        {/* Artist grid */}
        {displayList.length > 0 && (
          <div>
            {!query.trim() && recent.length > 0 && (
              <p className="text-text-muted text-xs uppercase tracking-widest mb-3">Recently explored</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {displayList.map(artist => (
                <Link
                  key={artist.id}
                  href={`/visualize/${artist.id}`}
                  className="group flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-3 hover:border-accent/50 hover:bg-surface-2 transition-all"
                >
                  {artist.image_url ? (
                    <img
                      src={artist.image_url}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                      <span className="text-accent font-bold text-sm">
                        {artist.name.charAt(0).toUpperCase()}
                      </span>
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
          </div>
        )}

        {query.trim() && !searching && results.length === 0 && (
          <p className="text-text-muted text-sm text-center py-8">No artists found for &quot;{query}&quot;</p>
        )}

        {!query.trim() && recent.length === 0 && (
          <div className="text-center py-12">
            <p className="text-text-muted text-sm">No recently explored artists.</p>
            <p className="text-text-muted text-xs mt-1">Search for an artist above, or visit an artist page first.</p>
          </div>
        )}
      </div>
    </div>
  )
}
