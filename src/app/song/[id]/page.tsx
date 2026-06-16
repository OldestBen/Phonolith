'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import type { Song, Credit, Annotation } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(date?: string) {
  if (!date) return '—'
  try {
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return date
  }
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
type Tab = 'lyrics' | 'about' | 'credits' | 'annotations'

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'lyrics', label: 'Lyrics' },
    { id: 'about', label: 'About' },
    { id: 'credits', label: 'Credits' },
    { id: 'annotations', label: 'Annotations' },
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
function LyricsTab({ song }: { song: Song }) {
  const [lyrics, setLyrics] = useState<string | null>(null)
  const [synced, setSynced] = useState(false)
  const [lyricsLoading, setLyricsLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [marked, setMarked] = useState(false)

  useEffect(() => {
    setLyricsLoading(true)
    fetch(`/api/song/${song.genius_id}/lyrics`)
      .then(r => r.ok ? r.json() : { content: null, synced_lyrics: null })
      .then(data => {
        setLyrics(data.content ?? null)
        setSynced(!!data.synced_lyrics)
      })
      .catch(() => setLyrics(null))
      .finally(() => setLyricsLoading(false))
  }, [song.genius_id])

  const handleCopy = async () => {
    if (!lyrics) return
    try {
      await navigator.clipboard.writeText(lyrics)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const handleDownload = () => {
    if (!lyrics) return
    const blob = new Blob([`${song.full_title ?? song.title}\n\n${lyrics}`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${song.title}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleMarkRead = async () => {
    try {
      await fetch(`/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.genius_id, event: 'lyrics_read' }),
      })
      setMarked(true)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Left: art + metadata */}
      <div className="shrink-0 lg:w-56">
        <div className="relative w-48 h-48 rounded-xl overflow-hidden bg-surface-2 mx-auto lg:mx-0 mb-4">
          {song.song_art_image_url ? (
            <Image
              src={song.song_art_image_url}
              alt={song.title}
              fill
              className="object-cover"
              sizes="200px"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-5xl">♪</div>
          )}
        </div>
        <h1 className="text-3xl font-bold text-text-primary leading-tight mb-1">
          {song.title}
        </h1>
        {song.full_title && song.full_title !== song.title && (
          <p className="text-text-muted text-sm mb-2">{song.full_title}</p>
        )}
        {song.artist_name && (
          <Link
            href={`/artist/${song.artist_id}`}
            className="text-accent text-sm hover:underline block mb-1"
          >
            {song.artist_name}
          </Link>
        )}
        {song.album_name && (
          <p className="text-text-muted text-sm mb-1">{song.album_name}</p>
        )}
        {song.release_date && (
          <p className="text-text-muted text-xs mb-4">{formatDate(song.release_date)}</p>
        )}
        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            onClick={handleCopy}
            disabled={!lyrics}
            className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs
                       font-medium hover:bg-surface-2 transition-colors disabled:opacity-40"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            disabled={!lyrics}
            className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs
                       font-medium hover:bg-surface-2 transition-colors disabled:opacity-40"
          >
            Download .txt
          </button>
          <button
            onClick={handleMarkRead}
            disabled={marked}
            className="px-3 py-1.5 rounded-lg bg-accent/20 border border-accent/30 text-accent text-xs
                       font-medium hover:bg-accent/30 transition-colors disabled:opacity-60"
          >
            {marked ? 'Marked ✓' : 'Mark as Read'}
          </button>
        </div>
      </div>

      {/* Right: lyrics */}
      <div className="flex-1 min-w-0">
        {lyricsLoading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 25 }).map((_, i) => (
              <div key={i} className="h-4 bg-surface-2 rounded" style={{ width: `${50 + (i % 7) * 7}%` }} />
            ))}
          </div>
        ) : lyrics ? (
          <>
            {synced && (
              <span className="inline-block mb-3 px-2 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
                Time-synced
              </span>
            )}
            <pre className="font-serif italic text-lg leading-relaxed whitespace-pre-wrap text-text-primary">
              {lyrics}
            </pre>
          </>
        ) : (
          <p className="text-text-muted text-sm">
            Lyrics not available. They may not have been fetched yet.
          </p>
        )}
      </div>
    </div>
  )
}

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

// ── Annotations tab ───────────────────────────────────────────────────────────
interface ParsedAnnotation {
  fragment: string
  body: string
  source: 'genius' | 'user'
}

interface NoteFormState {
  lineIdx: number
  text: string
  saving: boolean
}

function AnnotationsTab({ song }: { song: Song }) {
  const [lyrics, setLyrics] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<ParsedAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLine, setExpandedLine] = useState<number | null>(null)
  const [noteForm, setNoteForm] = useState<NoteFormState | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/song/${song.genius_id}/lyrics`).then(r => r.ok ? r.json() : { content: null }),
      fetch(`/api/song/${song.genius_id}/annotations`).then(r => r.ok ? r.json() : { annotations: [] }),
    ])
      .then(([lyricsData, annoData]) => {
        setLyrics(lyricsData.content ?? null)
        setAnnotations(annoData.annotations ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [song.genius_id])

  const findAnnotation = useCallback((line: string): ParsedAnnotation | undefined => {
    if (!line.trim()) return undefined
    return annotations.find(a => line.includes(a.fragment))
  }, [annotations])

  const handleSaveNote = async (lineText: string) => {
    if (!noteForm || !noteForm.text.trim()) return
    setNoteForm(f => f ? { ...f, saving: true } : null)
    try {
      await fetch(`/api/song/${song.genius_id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fragment: lineText.trim(), body: noteForm.text, source: 'user' }),
      })
      setAnnotations(prev => [...prev, { fragment: lineText.trim(), body: noteForm.text, source: 'user' }])
      setSavedMessage('Note saved!')
      setTimeout(() => setSavedMessage(null), 2000)
      setNoteForm(null)
    } catch {
      setNoteForm(f => f ? { ...f, saving: false } : null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="h-5 bg-surface-2 rounded" style={{ width: `${55 + (i % 5) * 8}%` }} />
        ))}
      </div>
    )
  }

  if (!lyrics) {
    return <p className="text-text-muted text-sm">Lyrics not available for annotation view.</p>
  }

  const lines = lyrics.split('\n')

  return (
    <div className="max-w-2xl">
      {savedMessage && (
        <div className="mb-4 px-3 py-2 bg-success/10 border border-success/30 text-success rounded-lg text-sm">
          {savedMessage}
        </div>
      )}
      <p className="text-text-muted text-xs mb-4">
        Click any line to see annotations or add your own note.
      </p>
      <div className="space-y-0.5">
        {lines.map((line, idx) => {
          const anno = findAnnotation(line)
          const isExpanded = expandedLine === idx
          const hasAnno = !!anno
          const isNoteTarget = noteForm?.lineIdx === idx

          return (
            <div key={idx}>
              <button
                onClick={() => {
                  setExpandedLine(isExpanded ? null : idx)
                  if (noteForm?.lineIdx !== idx) setNoteForm(null)
                }}
                className={`w-full text-left px-2 py-0.5 rounded text-base font-serif italic leading-relaxed transition-colors ${
                  line.trim() === ''
                    ? 'h-3 block'
                    : hasAnno
                    ? 'text-accent/90 hover:bg-accent/5 cursor-pointer'
                    : 'text-text-primary hover:bg-surface-2 cursor-pointer'
                }`}
              >
                {line || ' '}
              </button>

              {/* Expanded annotation */}
              {isExpanded && line.trim() !== '' && (
                <div className="ml-2 mt-1 mb-2">
                  {anno ? (
                    <div
                      className={`px-3 py-2 rounded-r text-sm text-text-primary leading-relaxed ${
                        anno.source === 'genius'
                          ? 'border-l-2 border-accent bg-accent/5'
                          : 'border-l-2 border-success/60 bg-success/5'
                      }`}
                    >
                      <span className="text-xs text-text-muted uppercase tracking-wide block mb-1">
                        {anno.source === 'genius' ? 'Genius annotation' : 'Your note'}
                      </span>
                      {anno.body}
                    </div>
                  ) : (
                    <p className="text-text-muted text-xs px-3 py-1">No annotation for this line.</p>
                  )}

                  {/* Add note button / form */}
                  {!isNoteTarget ? (
                    <button
                      onClick={() => setNoteForm({ lineIdx: idx, text: '', saving: false })}
                      className="mt-1 text-xs text-text-muted hover:text-accent transition-colors px-3"
                    >
                      + Add note
                    </button>
                  ) : (
                    <div className="mt-2 px-3">
                      <textarea
                        value={noteForm?.text ?? ''}
                        onChange={e => setNoteForm(f => f ? { ...f, text: e.target.value } : null)}
                        placeholder="Write your note…"
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary
                                   placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleSaveNote(line)}
                          disabled={noteForm?.saving || !noteForm?.text.trim()}
                          className="px-3 py-1 bg-accent text-white text-xs rounded-lg hover:bg-accent/80
                                     transition-colors disabled:opacity-50"
                        >
                          {noteForm?.saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setNoteForm(null)}
                          className="px-3 py-1 bg-surface border border-border text-text-muted text-xs
                                     rounded-lg hover:text-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
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
      {activeTab === 'lyrics' && <LyricsTab song={song} />}
      {activeTab === 'about' && <AboutTab song={song} />}
      {activeTab === 'credits' && <CreditsTab song={song} />}
      {activeTab === 'annotations' && <AnnotationsTab song={song} />}
    </div>
  )
}
