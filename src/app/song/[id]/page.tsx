'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Song, Credit } from '@/lib/types'
import LyricsReader from '@/components/LyricsReader'

// ── Tab bar ───────────────────────────────────────────────────────────────────
// Lyrics + Annotations used to be two separate tabs, each fetching lyrics
// independently and duplicating annotation-fragment-matching logic. They're
// merged into one "Lyrics" tab backed by the shared LyricsReader (which
// already combines both) rather than keeping two tabs that point at the
// same reader.
type Tab = 'lyrics' | 'about' | 'credits'

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'lyrics', label: 'Lyrics' },
    { id: 'about', label: 'About' },
    { id: 'credits', label: 'Credits' },
  ]
  return (
    <div className="flex border-b border-border mb-6">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
            active === t.id
              ? 'text-accent'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {t.label}
          {active === t.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t" />
          )}
        </button>
      ))}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function SongSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex gap-6 mb-8">
        <div className="w-48 h-48 bg-surface-2 rounded-xl shrink-0" />
        <div className="flex-1 pt-2">
          <div className="h-8 bg-surface-2 rounded w-2/3 mb-3" />
          <div className="h-4 bg-surface-2 rounded w-1/2 mb-2" />
          <div className="h-4 bg-surface-2 rounded w-1/3 mb-2" />
          <div className="h-4 bg-surface-2 rounded w-1/4" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="h-4 bg-surface-2 rounded" style={{ width: `${60 + Math.random() * 30}%` }} />
        ))}
      </div>
    </div>
  )
}

// ── Lyrics tab ────────────────────────────────────────────────────────────────
// Formerly this page's own LyricsTab + AnnotationsTab (each with its own
// lyrics fetch and annotation-fragment-matching). Both are now the shared
// <LyricsReader> — see its render call in the "lyrics" tab branch below.

// ── About tab ─────────────────────────────────────────────────────────────────
function AboutTab({ song }: { song: Song }) {
  const [description, setDescription] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/song/${song.genius_id}/about`)
      .then(r => r.ok ? r.json() : { description: null })
      .then(data => setDescription(data.description ?? null))
      .catch(() => setDescription(null))
      .finally(() => setLoading(false))
  }, [song.genius_id])

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[90, 70, 80, 60].map((w, i) => (
          <div key={i} className="h-4 bg-surface-2 rounded" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }

  if (!description) {
    return <p className="text-text-muted text-sm">No description available.</p>
  }

  // Split on double newlines for paragraph breaks
  const paragraphs = description.split(/\n{2,}/).filter(Boolean)
  return (
    <div className="prose max-w-2xl">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-text-primary text-base leading-relaxed mb-4">
          {para.trim()}
        </p>
      ))}
    </div>
  )
}

// ── Credits tab ───────────────────────────────────────────────────────────────
function CreditsTab({ song }: { song: Song }) {
  const [credits, setCredits] = useState<Credit[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    setLoading(true)
    fetch(`/api/song/${song.genius_id}/credits`)
      .then(r => r.ok ? r.json() : { credits: [] })
      .then(data => setCredits(data.credits ?? []))
      .catch(() => setCredits([]))
      .finally(() => setLoading(false))
  }, [song.genius_id])

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 bg-surface-2 rounded" />
        ))}
      </div>
    )
  }

  const allCredits: { role: string; name: string }[] = [
    ...(song.artist_name ? [{ role: 'Primary Artist', name: song.artist_name }] : []),
    ...credits.map(c => ({ role: c.role, name: c.name })),
  ]

  return (
    <div className="max-w-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-text-muted font-medium py-2 pr-8 w-1/3">Role</th>
            <th className="text-left text-text-muted font-medium py-2">Name</th>
          </tr>
        </thead>
        <tbody>
          {allCredits.map((c, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-surface-2 transition-colors">
              <td className="py-2.5 pr-8 text-text-muted">{c.role}</td>
              <td className="py-2.5">
                <button
                  onClick={() => router.push(`/?q=${encodeURIComponent(c.name)}`)}
                  className="text-text-primary hover:text-accent transition-colors text-left"
                >
                  {c.name}
                </button>
              </td>
            </tr>
          ))}
          {allCredits.length === 0 && (
            <tr>
              <td colSpan={2} className="py-4 text-text-muted text-center">No credits available.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SongPage() {
  const { id } = useParams<{ id: string }>()
  const [song, setSong] = useState<Song | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('lyrics')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/song/${id}`)
      .then(r => r.ok ? r.json() : { song: null })
      .then(data => setSong(data.song ?? data))
      .catch(() => setSong(null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <SongSkeleton />
      </div>
    )
  }

  if (!song) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted">Song not found.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <TabBar active={activeTab} onChange={setActiveTab} />
      {activeTab === 'lyrics' && <LyricsReader songId={id} />}
      {activeTab === 'about' && <AboutTab song={song} />}
      {activeTab === 'credits' && <CreditsTab song={song} />}
    </div>
  )
}
