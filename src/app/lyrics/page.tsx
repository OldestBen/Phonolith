'use client'

/**
 * Standalone "Lyrics & Annotations" reader — a top-level destination (not
 * reached by drilling into an artist first), so it needs its own way to
 * find a song: a local search box wired to /api/song/search (songs already
 * known to this instance — NOT a live Genius search) plus a `?song=` query
 * param for direct linking.
 */

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { ScreenDesc } from '@/components/panel'
import LyricsReader from '@/components/LyricsReader'

interface SongSearchResult {
  id: number
  genius_id: number
  title: string
  artist_name: string
  album_name: string | null
}

function LyricsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeSongId = searchParams.get('song')

  const [inputValue, setInputValue] = useState('')
  const [results, setResults] = useState<SongSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  usePageHeader('Lyrics & Annotations', 'search & read')

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/song/search?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    setShowDropdown(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  const pickSong = (s: SongSearchResult) => {
    setShowDropdown(false)
    setInputValue('')
    setResults([])
    router.push(`/lyrics?song=${s.genius_id}`)
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-[14px] px-6 py-6">
      <ScreenDesc>
        Find a song already known to Phonolith (searches the local library of previously-viewed songs — not a
        live Genius lookup) and read its lyrics with inline Genius + user annotations.
      </ScreenDesc>

      <div ref={containerRef} className="relative max-w-[460px]">
        <input
          type="text"
          value={inputValue}
          onChange={handleChange}
          onFocus={() => setShowDropdown(true)}
          placeholder="Search songs or artists…"
          className="w-full bg-surface border border-border focus:border-accent-dim rounded-lg px-3.5 py-2 text-sm text-text-primary placeholder:text-text-ghost outline-none transition-colors"
        />

        {showDropdown && inputValue.trim() && (
          <div className="absolute z-20 mt-1.5 w-full rounded-lg border border-border bg-[#101012] shadow-[0_8px_24px_rgba(0,0,0,.5)] overflow-hidden max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-3.5 py-2.5 text-xs text-text-ghost">Searching…</p>
            ) : results.length > 0 ? (
              results.map(s => (
                <button
                  key={s.genius_id}
                  onClick={() => pickSong(s)}
                  className="w-full text-left px-3.5 py-2 hover:bg-surface-2 transition-colors border-b border-border/50 last:border-0"
                >
                  <p className="m-0 text-sm text-text-primary truncate">{s.title}</p>
                  <p className="mt-0.5 text-xs text-text-muted truncate">
                    {s.artist_name}
                    {s.album_name ? ` · ${s.album_name}` : ''}
                  </p>
                </button>
              ))
            ) : (
              <p className="px-3.5 py-2.5 text-xs text-text-ghost">
                No matches — song must have been visited once before it&apos;s searchable here.
              </p>
            )}
          </div>
        )}
      </div>

      {activeSongId ? (
        <LyricsReader songId={activeSongId} />
      ) : (
        <div className="rounded-[10px] border border-border bg-[#101012] px-6 py-14 text-center">
          <p className="m-0 text-sm text-text-muted">Search for a song above to start reading.</p>
        </div>
      )}
    </div>
  )
}

export default function LyricsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-6 text-text-muted text-sm">Loading…</div>}>
      <LyricsPageInner />
    </Suspense>
  )
}
