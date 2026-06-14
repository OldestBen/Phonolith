'use client'

import { useState } from 'react'
import type { Annotation } from '@/lib/types'

interface AnnotationsViewProps {
  lyrics: string
  annotations: Annotation[]
  songGeniusId: number
  onAnnotationAdded?: () => void
}

export default function AnnotationsView({ lyrics, annotations, songGeniusId, onAnnotationAdded }: AnnotationsViewProps) {
  const [expandedLine, setExpandedLine] = useState<number | null>(null)
  const [addingLine, setAddingLine] = useState<number | null>(null)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)

  const lines = lyrics.split('\n')

  const findAnnotation = (line: string) =>
    annotations.find(a => line.toLowerCase().includes(a.fragment.toLowerCase().slice(0, 20)))

  const handleSave = async (lineIdx: number, fragment: string) => {
    if (!noteText.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/song/${songGeniusId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fragment, body: noteText.trim() }),
      })
      setNoteText('')
      setAddingLine(null)
      onAnnotationAdded?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const annotation = findAnnotation(line)
        const isExpanded = expandedLine === i
        const isAdding = addingLine === i

        return (
          <div key={i}>
            <div
              className={`flex items-start gap-2 group px-3 py-1 rounded-lg cursor-pointer
                         transition-colors ${annotation ? 'hover:bg-accent/5' : 'hover:bg-surface-2'}`}
              onClick={() => setExpandedLine(isExpanded ? null : i)}
            >
              {annotation && (
                <div className="w-0.5 bg-accent self-stretch rounded-full mt-1 flex-shrink-0" />
              )}
              <p className={`font-serif italic text-base leading-relaxed flex-1 ${
                line.match(/^\[.+\]$/) ? 'text-text-muted' : 'text-text-primary'
              }`}>
                {line || ' '}
              </p>
              {line.trim() && (
                <button
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-xs text-accent transition-opacity flex-shrink-0 mt-1"
                  onClick={e => {
                    e.stopPropagation()
                    setAddingLine(isAdding ? null : i)
                    setExpandedLine(null)
                  }}
                >
                  + note
                </button>
              )}
            </div>

            {isExpanded && annotation && (
              <div className="mx-3 mb-2 pl-4 border-l-2 border-accent/30 bg-accent/5 rounded-r-lg p-3">
                <p className="text-sm text-text-muted mb-1 uppercase tracking-wider">
                  {annotation.source === 'user' ? 'Your note' : 'Genius'}
                </p>
                <p className="text-sm text-text-primary">{annotation.body || 'No annotation text.'}</p>
              </div>
            )}

            {isAdding && (
              <div className="mx-3 mb-2 p-3 bg-surface-2 rounded-lg border border-border">
                <p className="text-xs text-text-muted mb-2">Note on: <em>&quot;{line.slice(0, 60)}{line.length > 60 ? '…' : ''}&quot;</em></p>
                <textarea
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm
                             text-text-primary placeholder:text-text-muted focus:outline-none
                             focus:border-accent focus:ring-1 focus:ring-accent/30 resize-none"
                  placeholder="Write your annotation..."
                  rows={3}
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleSave(i, line)}
                    disabled={saving || !noteText.trim()}
                    className="px-3 py-1.5 rounded-lg bg-accent text-background font-semibold text-sm
                               hover:bg-accent-dim transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setAddingLine(null)}
                    className="px-3 py-1.5 rounded-lg border border-border text-text-muted text-sm hover:text-text-primary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
