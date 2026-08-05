'use client'

/**
 * Shared lyrics + annotations reader — matches the Claude Design mockup's
 * bespoke `isLyrics` screen (Phonolith.dc.html lines ~194-274) exactly: a
 * two-column `minmax(0,1fr) 340px` grid with a left lyrics-reader panel
 * (header strip, action row + annotation-count summary, numbered lyric
 * lines with section-heading detection and click-to-expand inline
 * annotation panels) and a right 340px sidebar of four stacked cards
 * (Credits · Genius / Song description / Tags / Read history).
 *
 * Used by both the standalone /lyrics reader and the per-song page, so the
 * fetch/parse/annotate logic lives in exactly one place.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Song, Tag, HistoryEvent } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ParsedAnnotation {
  id?: number
  fragment: string
  body: string
  source: 'genius' | 'user'
  created_at?: string
}

interface LyricsResponse {
  content: string | null
  synced_lyrics: string | null
  scraped_at: string
}

interface CreditRow {
  role: string
  name: string
}

type ParsedLine =
  | { type: 'blank' }
  | { type: 'heading'; text: string }
  | { type: 'line'; text: string; n: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strips leading `[mm:ss.xx]` (possibly repeated) timestamp tags from an LRC
 * line, and drops pure metadata tag lines (`[ar:...]`, `[ti:...]`, etc). */
function parseSyncedLyrics(lrc: string): string {
  const lines: string[] = []
  for (const raw of lrc.split('\n')) {
    const metaTag = /^\s*\[[a-zA-Z]+:[^\]]*\]\s*$/
    if (metaTag.test(raw)) continue
    const stripped = raw.replace(/^(\[\d{2}:\d{2}(?:\.\d{1,3})?\])+/, '')
    lines.push(stripped)
  }
  return lines.join('\n')
}

/** Simple heuristic: a whole trimmed line wrapped in a single `[...]` pair
 * (e.g. `[Verse 1]`, `[Chorus]`) is a section heading; blank lines are
 * section breaks (rendered as spacing, no label); everything else is a
 * regular, numbered lyric line. */
function parseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  let n = 1
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) {
      out.push({ type: 'blank' })
      continue
    }
    const headingMatch = line.trim().match(/^\[([^\]]+)\]$/)
    if (headingMatch) {
      out.push({ type: 'heading', text: headingMatch[1] })
      continue
    }
    out.push({ type: 'line', text: line, n: n++ })
  }
  return out
}

function truncateMid(s: string, head = 4, tail = 4): string {
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

function formatCacheDate(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}

function formatHistoryWhen(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ')
  } catch {
    return iso
  }
}

const HISTORY_LABELS: Record<string, string> = {
  lyrics_read: 'Lyrics read',
  lyrics_download: 'Lyrics downloaded',
  lyrics_marked_read: 'Marked as read',
  annotation_added: 'Annotation added',
  play: 'Played',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LyricsReader({ songId }: { songId: string }) {
  const [song, setSong] = useState<Song | null>(null)
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null)
  const [annotations, setAnnotations] = useState<ParsedAnnotation[]>([])
  const [credits, setCredits] = useState<CreditRow[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [readHistory, setReadHistory] = useState<HistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [copied, setCopied] = useState(false)
  const [marked, setMarked] = useState(false)
  const [refetching, setRefetching] = useState(false)

  const [expanded, setExpanded] = useState<number | null>(null)
  const [addForm, setAddForm] = useState<{ idx: number; text: string; saving: boolean } | null>(null)

  const [addingTag, setAddingTag] = useState(false)
  const [allTags, setAllTags] = useState<Tag[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setExpanded(null)
    setAddForm(null)
    setMarked(false)
    setAddingTag(false)

    Promise.all([
      fetch(`/api/song/${songId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/song/${songId}/lyrics`).then(r => r.ok ? r.json() : { content: null, synced_lyrics: null, scraped_at: '' }),
      // The route returns a bare array, NOT `{ annotations: [...] }` — unwrap
      // directly, not `.annotations` (that bug used to make Genius-sourced
      // annotations never load).
      fetch(`/api/song/${songId}/annotations`).then(r => r.ok ? r.json() : []),
      fetch(`/api/song/${songId}/credits`).then(r => r.ok ? r.json() : []),
      fetch(`/api/song/${songId}/tags`).then(r => r.ok ? r.json() : []),
    ])
      .then(([songData, lyricsData, annoData, creditsData, tagsData]) => {
        if (cancelled) return
        const s = songData?.song ?? songData
        setSong(s ?? null)
        setLyrics(lyricsData)
        setAnnotations(annoData ?? [])
        setCredits(Array.isArray(creditsData) ? creditsData : [])
        setTags(Array.isArray(tagsData) ? tagsData : [])
        if (!s) setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [songId])

  const fetchHistory = useCallback((dbSongId: number) => {
    fetch(`/api/history?song_id=${dbSongId}&limit=8`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setReadHistory(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (song?.id) fetchHistory(song.id)
  }, [song?.id, fetchHistory])

  // Clean per-line text: prefer synced_lyrics (stripped of timestamps) when
  // available since it's more reliably line-broken than raw scraped content.
  const displayText = useMemo(() => {
    if (!lyrics) return null
    if (lyrics.synced_lyrics) return parseSyncedLyrics(lyrics.synced_lyrics)
    return lyrics.content ?? null
  }, [lyrics])

  const parsedLines = useMemo(() => displayText ? parseLines(displayText) : [], [displayText])

  const findAnnotations = useCallback((line: string): ParsedAnnotation[] => {
    if (!line.trim()) return []
    return annotations.filter(a => a.fragment && line.includes(a.fragment))
  }, [annotations])

  const handleCopy = async () => {
    if (!displayText) return
    try {
      await navigator.clipboard.writeText(displayText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // Real LRC export — only enabled when LRCLIB gave us actual timestamped
  // lyrics. Plain scraped text has no timing data, so exporting it as
  // ".lrc" would be a fabricated file, not a real one.
  const handleDownloadLrc = () => {
    if (!lyrics?.synced_lyrics || !song) return
    const blob = new Blob([lyrics.synced_lyrics], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${song.title}.lrc`
    a.click()
    URL.revokeObjectURL(url)
    fetch(`/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: song.id, event: 'lyrics_download' }),
    }).catch(() => {}).finally(() => { if (song.id) fetchHistory(song.id) })
  }

  const handleMarkRead = async () => {
    if (!song) return
    try {
      // `song.id` is the internal DB id that `history.song_id` references —
      // NOT `song.genius_id` (those diverge for most rows).
      await fetch(`/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.id, event: 'lyrics_marked_read' }),
      })
      setMarked(true)
      fetchHistory(song.id)
    } catch { /* ignore */ }
  }

  const handleAddAnnotationClick = () => {
    const idx = parsedLines.findIndex(l => l.type === 'line')
    if (idx === -1) return
    setExpanded(idx)
    setAddForm({ idx, text: '', saving: false })
    requestAnimationFrame(() => {
      document.getElementById(`lyric-line-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const handleRefetchGenius = async () => {
    setRefetching(true)
    try {
      const res = await fetch(`/api/song/${songId}/lyrics?refresh=1`)
      if (res.ok) setLyrics(await res.json())
    } catch { /* ignore */ }
    finally { setRefetching(false) }
  }

  const handleSaveNote = async (lineText: string, idx: number) => {
    if (!addForm || !addForm.text.trim() || !song) return
    setAddForm(f => f ? { ...f, saving: true } : null)
    try {
      const res = await fetch(`/api/song/${song.genius_id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fragment: lineText.trim(), body: addForm.text.trim() }),
      })
      const created = res.ok ? await res.json() : null
      setAnnotations(prev => [
        ...prev,
        created ?? { fragment: lineText.trim(), body: addForm.text.trim(), source: 'user' as const },
      ])
      setAddForm(null)
      setExpanded(idx)
      if (song.id) fetchHistory(song.id)
    } catch {
      setAddForm(f => f ? { ...f, saving: false } : null)
    }
  }

  const openAddTag = () => {
    setAddingTag(true)
    if (allTags.length === 0) {
      fetch('/api/tags').then(r => r.ok ? r.json() : []).then(data => setAllTags(Array.isArray(data) ? data : [])).catch(() => {})
    }
  }

  const handleAttachTag = async (tagId: number) => {
    setAddingTag(false)
    try {
      await fetch(`/api/song/${songId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: tagId }),
      })
      const res = await fetch(`/api/song/${songId}/tags`)
      if (res.ok) setTags(await res.json())
    } catch { /* ignore */ }
  }

  // ── Loading / error states ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-[10px] border border-border bg-[#101012] overflow-hidden animate-pulse">
        <div className="flex items-center gap-3 px-[18px] py-3.5 border-b border-border bg-surface">
          <div className="w-[52px] h-[52px] rounded bg-surface-2 shrink-0" />
          <div className="flex-1">
            <div className="h-4 bg-surface-2 rounded w-1/3 mb-2" />
            <div className="h-3 bg-surface-2 rounded w-1/2" />
          </div>
        </div>
        <div className="p-[22px] space-y-2.5">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="h-4 bg-surface-2 rounded" style={{ width: `${50 + (i % 7) * 7}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (error || !song) {
    return (
      <div className="rounded-[10px] border border-border bg-[#101012] px-6 py-10 text-center">
        <p className="m-0 text-sm text-text-muted">Song not found.</p>
      </div>
    )
  }

  const mbId = song.mb_id
  // No ISRC field exists anywhere in this app's data model yet (checked
  // songs/albums/tracks schema) — cast defensively so the badge appears the
  // moment such a field is actually populated, without fabricating one now.
  const isrc = (song as unknown as { isrc?: string }).isrc

  const userAnnoCount = annotations.filter(a => a.source === 'user').length
  const releaseYear = song.release_date ? new Date(song.release_date).getFullYear() : undefined

  const allCredits: CreditRow[] = [
    ...(song.artist_name ? [{ role: 'Primary Artist', name: song.artist_name }] : []),
    ...credits,
  ]

  const unattachedTags = allTags.filter(t => !tags.some(x => x.id === t.id))

  return (
    <div className="grid gap-[18px] items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      {/* LEFT: lyrics reader panel */}
      <div className="rounded-[10px] border border-border bg-[#101012] overflow-hidden">
        {/* Header strip */}
        <div className="flex items-center gap-3 px-[18px] py-3.5 border-b border-border bg-surface">
          <div
            className="w-[52px] h-[52px] shrink-0 border border-[#3f3f46] rounded overflow-hidden flex items-center justify-center text-[8px] text-text-ghost"
            style={{ background: 'repeating-linear-gradient(135deg,#1c1c20 0 6px,#232329 6px 12px)' }}
          >
            {song.song_art_image_url ? (
              <Image src={song.song_art_image_url} alt={song.title} width={52} height={52} className="object-cover w-full h-full" />
            ) : 'art'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[14px] font-semibold text-text-primary truncate">{song.title}</p>
            <p className="mt-0.5 text-[11px] text-text-muted truncate">
              {song.artist_name && (
                <Link href={`/artist/${song.artist_id}`} className="hover:text-accent-bright transition-colors">
                  {song.artist_name}
                </Link>
              )}
              {song.album_name && (
                <span className="text-text-faint">
                  {song.artist_name ? ' — ' : ''}
                  {song.album_name}
                  {releaseYear ? ` (${releaseYear})` : ''}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <span
              className="rounded-[5px] px-2 py-[3px] text-[10px] text-accent-bright border"
              style={{ borderColor: '#6d28d9', background: 'rgba(109,40,217,.22)' }}
            >
              Genius ✓
            </span>
            {mbId && (
              <span className="rounded-[5px] border border-border px-2 py-[3px] text-[10px] text-text-muted">
                MBID {truncateMid(mbId)}
              </span>
            )}
            {isrc && (
              <span className="rounded-[5px] border border-border px-2 py-[3px] text-[10px] text-text-muted">
                ISRC {isrc}
              </span>
            )}
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 px-[18px] py-2 border-b border-border" style={{ background: '#131316' }}>
          <button
            onClick={handleCopy}
            disabled={!displayText}
            className="rounded-md border border-[#3f3f46] bg-surface px-[9px] py-1 text-[10.5px] text-text-secondary hover:border-accent-dim hover:text-accent-bright transition-colors disabled:opacity-40"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDownloadLrc}
            disabled={!lyrics?.synced_lyrics}
            title={!lyrics?.synced_lyrics ? 'No synced (timestamped) lyrics available for this song' : undefined}
            className="rounded-md border border-[#3f3f46] bg-surface px-[9px] py-1 text-[10.5px] text-text-secondary hover:border-accent-dim hover:text-accent-bright transition-colors disabled:opacity-40"
          >
            Download .lrc
          </button>
          <button
            onClick={handleMarkRead}
            disabled={marked}
            className="rounded-md border border-[#3f3f46] bg-surface px-[9px] py-1 text-[10.5px] text-text-secondary hover:border-accent-dim hover:text-accent-bright transition-colors disabled:opacity-60"
          >
            {marked ? 'Marked ✓' : 'Mark as read'}
          </button>
          <button
            onClick={handleAddAnnotationClick}
            disabled={!displayText}
            className="rounded-md border border-[#3f3f46] bg-surface px-[9px] py-1 text-[10.5px] text-text-secondary hover:border-accent-dim hover:text-accent-bright transition-colors disabled:opacity-40"
          >
            Add annotation
          </button>
          <button
            onClick={handleRefetchGenius}
            disabled={refetching}
            className="rounded-md border border-[#3f3f46] bg-surface px-[9px] py-1 text-[10.5px] text-text-secondary hover:border-accent-dim hover:text-accent-bright transition-colors disabled:opacity-60"
          >
            {refetching ? 'Re-fetching…' : 'Re-fetch Genius'}
          </button>
          <div className="flex-1" />
          <span className="text-[10px] text-text-ghost">
            {annotations.length} annotation{annotations.length === 1 ? '' : 's'} · {userAnnoCount} yours · cached {formatCacheDate(lyrics?.scraped_at)}
          </span>
        </div>

        {/* Lyrics body */}
        <div className="px-[22px] pt-[18px] pb-[26px] flex flex-col gap-0.5">
          {!displayText ? (
            <p className="text-text-muted text-sm">Lyrics not available. They may not have been fetched yet.</p>
          ) : (
            parsedLines.map((l, idx) => {
              if (l.type === 'blank') return <div key={idx} className="h-3" />

              if (l.type === 'heading') {
                return (
                  <p key={idx} className="mt-4 mb-1.5 text-[10px] tracking-[.22em] uppercase" style={{ color: '#6d28d9' }}>
                    {l.text}
                  </p>
                )
              }

              const matches = findAnnotations(l.text)
              const hasNote = matches.length > 0
              const isExpanded = expanded === idx
              const isAddTarget = addForm?.idx === idx

              return (
                <div key={idx} id={`lyric-line-${idx}`}>
                  <div
                    onClick={() => {
                      setExpanded(isExpanded ? null : idx)
                      if (addForm?.idx !== idx) setAddForm(null)
                    }}
                    className="flex items-start gap-2 rounded-md px-2 py-[3px] cursor-pointer transition-colors hover:bg-accent-dim/10"
                  >
                    <span className="w-[22px] shrink-0 text-[9.5px] text-[#3f3f46] pt-[3px]">
                      {String(l.n).padStart(2, '0')}
                    </span>
                    <span
                      className={`text-[14.5px] leading-[1.85] ${hasNote ? 'text-text-primary underline' : 'text-text-muted'}`}
                      style={hasNote ? {
                        textDecorationColor: 'rgba(139,92,246,.85)',
                        textDecorationThickness: '2px',
                        textUnderlineOffset: '4px',
                      } : undefined}
                    >
                      {l.text}
                    </span>
                    {hasNote && (
                      <span
                        className="ml-auto shrink-0 rounded px-[5px] text-[9px] text-accent border"
                        style={{ borderColor: 'rgba(124,58,237,.5)' }}
                      >
                        {matches.length} ann
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="ml-[22px] mt-1.5 mb-2.5 flex flex-col gap-2">
                      {matches.length > 0 ? (
                        matches.map((a, i) => (
                          <div
                            key={a.id ?? i}
                            className="rounded-r-lg px-3.5 py-[11px]"
                            style={{
                              borderLeft: '2px solid #6d28d9',
                              background: 'linear-gradient(90deg,rgba(109,40,217,.16),rgba(109,40,217,.03))',
                            }}
                          >
                            <p className="m-0 mb-1 text-[9px] tracking-[.18em] uppercase text-accent">
                              {a.source === 'genius' ? 'Genius' : 'Your annotation'}
                            </p>
                            <p className="m-0 text-[11.5px] leading-[1.7] text-text-secondary" style={{ textWrap: 'pretty' as 'pretty' }}>
                              {a.body}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="m-0 text-[10.5px] text-text-ghost px-1">No annotation for this line yet.</p>
                      )}

                      {!isAddTarget ? (
                        <button
                          onClick={() => setAddForm({ idx, text: '', saving: false })}
                          className="self-start text-[10.5px] text-text-ghost hover:text-accent-bright transition-colors px-1"
                        >
                          + Add your annotation
                        </button>
                      ) : (
                        <div className="flex flex-col gap-1.5 px-1">
                          <input
                            value={addForm?.text ?? ''}
                            onChange={e => setAddForm(f => f ? { ...f, text: e.target.value } : null)}
                            onKeyDown={e => e.key === 'Enter' && handleSaveNote(l.text, idx)}
                            placeholder="Write your annotation…"
                            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[11.5px] text-text-primary placeholder:text-text-ghost focus:outline-none focus:border-accent-dim"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveNote(l.text, idx)}
                              disabled={addForm?.saving || !addForm?.text.trim()}
                              className="rounded-md px-2.5 py-1 text-[10.5px] font-medium text-white transition-colors disabled:opacity-50"
                              style={{ background: '#6d28d9' }}
                            >
                              {addForm?.saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setAddForm(null)}
                              className="rounded-md border border-border bg-surface px-2.5 py-1 text-[10.5px] text-text-muted hover:text-text-primary transition-colors"
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
            })
          )}
        </div>
      </div>

      {/* RIGHT: 340px sidebar — Credits · Genius / Song description / Tags / Read history */}
      <div className="flex flex-col gap-3">
        <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
          <p className="m-0 mb-[9px] text-[9px] tracking-[.2em] uppercase text-text-ghost">Credits · Genius</p>
          {allCredits.length > 0 ? (
            allCredits.map((c, i) => (
              <div key={i} className="flex gap-2 py-[3px]">
                <span className="w-[86px] shrink-0 text-[10.5px] text-text-ghost">{c.role}</span>
                <span className="text-[10.5px] text-text-secondary">{c.name}</span>
              </div>
            ))
          ) : (
            <p className="m-0 text-[10.5px] text-text-ghost">No credits available.</p>
          )}
        </div>

        <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
          <p className="m-0 mb-[9px] text-[9px] tracking-[.2em] uppercase text-text-ghost">Song description</p>
          {song.description ? (
            <p className="m-0 text-[11px] leading-[1.75] text-text-muted" style={{ textWrap: 'pretty' as 'pretty' }}>
              {song.description}
            </p>
          ) : (
            <p className="m-0 text-[11px] leading-[1.75] text-text-ghost">No description available.</p>
          )}
        </div>

        <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
          <p className="m-0 mb-[9px] text-[9px] tracking-[.2em] uppercase text-text-ghost">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(t => (
              <span
                key={t.id}
                className="rounded-full border border-border bg-surface px-[9px] py-[3px] text-[10px] text-text-muted hover:border-accent-dim hover:text-accent-bright transition-colors"
              >
                {t.name}
              </span>
            ))}
            {!addingTag ? (
              <button
                onClick={openAddTag}
                className="rounded-full border border-border bg-surface px-[9px] py-[3px] text-[10px] text-text-muted hover:border-accent-dim hover:text-accent-bright transition-colors"
              >
                + tag
              </button>
            ) : (
              <select
                autoFocus
                defaultValue=""
                onChange={e => e.target.value && handleAttachTag(parseInt(e.target.value))}
                onBlur={() => setAddingTag(false)}
                className="rounded-full border border-border bg-surface px-2 py-[3px] text-[10px] text-text-muted"
              >
                <option value="" disabled>pick a tag…</option>
                {unattachedTags.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {tags.length === 0 && !addingTag && (
              <span className="text-[10px] text-text-ghost self-center">No tags yet.</span>
            )}
          </div>
        </div>

        <div className="rounded-[10px] border border-border bg-[#101012] px-[14px] py-[13px]">
          <p className="m-0 mb-[9px] text-[9px] tracking-[.2em] uppercase text-text-ghost">Read history</p>
          {readHistory.length > 0 ? (
            readHistory.map(h => (
              <div key={h.id} className="flex justify-between py-[3px] text-[10.5px]">
                <span className="text-text-muted">{HISTORY_LABELS[h.event] ?? h.event}</span>
                <span className="text-text-ghost">{formatHistoryWhen(h.created_at)}</span>
              </div>
            ))
          ) : (
            <p className="m-0 text-[10.5px] text-text-ghost">No read history yet for this song.</p>
          )}
        </div>
      </div>
    </div>
  )
}
