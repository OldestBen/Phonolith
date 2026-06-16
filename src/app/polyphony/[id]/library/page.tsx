'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface PeerFile {
  hash: string
  title: string | null
  artist: string | null
  album: string | null
  track_number: number | null
}

export default function PeerLibraryPage() {
  const params = useParams<{ id: string }>()
  const peerId = params.id
  const [files, setFiles] = useState<PeerFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/polyphony/peers/${peerId}/library`)
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'Failed to load library.')
        setFiles(d.files ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [peerId])

  const play = (hash: string) => {
    const audio = new Audio(`/api/polyphony/peers/${peerId}/stream/${hash}`)
    audio.play().catch(() => setError('Could not play that track.'))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-6">Peer Library</h1>

      {loading && <p className="text-text-muted text-sm">Loading…</p>}
      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex flex-col gap-1">
        {files.map(f => (
          <button
            key={f.hash}
            onClick={() => play(f.hash)}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 text-left transition-colors"
          >
            <div className="min-w-0">
              <p className="text-text-primary text-sm truncate">{f.title ?? f.hash}</p>
              <p className="text-text-muted text-xs truncate">{f.artist}{f.album ? ` — ${f.album}` : ''}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
