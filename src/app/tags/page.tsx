'use client'

import { useState, useEffect } from 'react'
import type { Tag } from '@/lib/types'

// ── Colour palette ────────────────────────────────────────────────────────────
const PALETTE = [
  '#a78bfa', // violet
  '#60a5fa', // blue
  '#34d399', // green
  '#f59e0b', // amber
  '#f472b6', // pink
  '#f87171', // red
]

// ── Tag pill ──────────────────────────────────────────────────────────────────
function TagPill({
  tag,
  onClick,
  onDelete,
}: {
  tag: Tag
  onClick: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer
                 transition-all hover:opacity-90"
      style={{
        backgroundColor: tag.color + '22',
        borderColor: tag.color + '55',
      }}
      onClick={onClick}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: tag.color }}
      />
      <span className="text-sm font-medium" style={{ color: tag.color }}>
        {tag.name}
      </span>
      <button
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
        className="ml-0.5 text-xs opacity-50 hover:opacity-100 transition-opacity leading-none"
        aria-label={`Delete tag ${tag.name}`}
      >
        ×
      </button>
    </div>
  )
}

// ── Colour picker ─────────────────────────────────────────────────────────────
function ColourPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2">
      {PALETTE.map(colour => (
        <button
          key={colour}
          onClick={() => onChange(colour)}
          className="w-7 h-7 rounded-full border-2 transition-all"
          style={{
            backgroundColor: colour,
            borderColor: value === colour ? '#fff' : 'transparent',
            transform: value === colour ? 'scale(1.15)' : 'scale(1)',
          }}
          aria-label={`Select colour ${colour}`}
        />
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedTag, setExpandedTag] = useState<number | null>(null)

  // New tag form
  const [newName, setNewName] = useState('')
  const [newColour, setNewColour] = useState(PALETTE[0])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/tags')
      .then(r => r.ok ? r.json() : { tags: [] })
      .then(data => setTags(data.tags ?? []))
      .catch(() => setTags([]))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const r = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColour }),
      })
      if (!r.ok) throw new Error('Failed to create tag')
      const data = await r.json()
      const created: Tag = data.tag ?? data
      setTags(prev => [...prev, created])
      setNewName('')
      setNewColour(PALETTE[0])
    } catch {
      setCreateError('Could not create tag — please try again.')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (tag: Tag) => {
    // Optimistic
    setTags(prev => prev.filter(t => t.id !== tag.id))
    try {
      await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' })
    } catch {
      // Re-add on failure
      setTags(prev => [...prev, tag].sort((a, b) => a.id - b.id))
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-8">Tags</h1>

      {/* Tag pill grid */}
      {loading ? (
        <div className="flex flex-wrap gap-3 animate-pulse mb-10">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 bg-surface-2 rounded-full" style={{ width: `${60 + i * 12}px` }} />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <p className="text-text-muted text-sm mb-10">No tags yet. Create your first one below.</p>
      ) : (
        <div className="flex flex-wrap gap-3 mb-8">
          {tags.map(tag => (
            <TagPill
              key={tag.id}
              tag={tag}
              onClick={() => setExpandedTag(expandedTag === tag.id ? null : tag.id)}
              onDelete={() => handleDelete(tag)}
            />
          ))}
        </div>
      )}

      {/* Expanded tag detail */}
      {expandedTag != null && (() => {
        const tag = tags.find(t => t.id === expandedTag)
        if (!tag) return null
        return (
          <div
            className="mb-8 p-4 rounded-xl border"
            style={{ borderColor: tag.color + '44', backgroundColor: tag.color + '0a' }}
          >
            <h2 className="font-semibold text-base mb-1" style={{ color: tag.color }}>
              {tag.name}
            </h2>
            <p className="text-text-muted text-sm">
              Explore songs with this tag — coming soon.
            </p>
          </div>
        )
      })()}

      {/* New tag form */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h2 className="text-text-primary font-semibold mb-4">New Tag</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div>
            <label className="text-text-muted text-xs uppercase tracking-widest block mb-2">Name</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Jazz, Favourite, Study…"
              className="bg-background border border-border text-text-primary text-sm rounded-lg
                         px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label className="text-text-muted text-xs uppercase tracking-widest block mb-2">Colour</label>
            <ColourPicker value={newColour} onChange={setNewColour} />
          </div>

          {/* Preview */}
          {newName.trim() && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-xs">Preview:</span>
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border"
                style={{
                  backgroundColor: newColour + '22',
                  borderColor: newColour + '55',
                  color: newColour,
                }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: newColour }} />
                {newName.trim()}
              </span>
            </div>
          )}

          {createError && (
            <p className="text-danger text-sm">{createError}</p>
          )}

          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium w-fit
                       hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Tag'}
          </button>
        </form>
      </div>
    </div>
  )
}
