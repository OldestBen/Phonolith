'use client'

import { useState, useCallback } from 'react'

interface LyricsViewProps {
  lyrics: string
  songTitle: string
  artistName: string
  synced?: boolean
  onMarkRead?: () => void
}

export default function LyricsView({ lyrics, songTitle, artistName, synced, onMarkRead }: LyricsViewProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(lyrics)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [lyrics])

  const handleDownload = useCallback(() => {
    const text = `${songTitle} — ${artistName}\n\n${lyrics}`
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artistName} - ${songTitle}.txt`.replace(/[/\\?%*:|"<>]/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }, [lyrics, songTitle, artistName])

  return (
    <div>
      <div className="flex gap-2 mb-6 items-center">
        {synced && (
          <span className="px-2 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
            Time-synced
          </span>
        )}
        <button
          onClick={handleCopy}
          className="px-4 py-2 rounded-lg border border-border text-text-muted hover:border-accent/40
                     hover:text-text-primary text-sm transition-colors"
        >
          {copied ? '✓ Copied!' : 'Copy'}
        </button>
        <button
          onClick={handleDownload}
          className="px-4 py-2 rounded-lg border border-border text-text-muted hover:border-accent/40
                     hover:text-text-primary text-sm transition-colors"
        >
          Download .txt
        </button>
        {onMarkRead && (
          <button
            onClick={onMarkRead}
            className="px-4 py-2 rounded-lg bg-accent text-background font-semibold text-sm
                       hover:bg-accent-dim transition-colors"
          >
            Mark as Read
          </button>
        )}
      </div>
      <pre className="font-serif italic text-lg leading-loose whitespace-pre-wrap text-text-primary">
        {lyrics}
      </pre>
    </div>
  )
}
