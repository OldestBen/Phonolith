'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface FeedEntry {
  peerId: string
  name: string
  online: boolean
  nowPlaying: { title: string; artist: string | null; updatedAt: string } | null
}

interface PeerRow {
  id: string
  name: string
  host: string
  share_library: boolean
}

export default function PolyphonyPage() {
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [peers, setPeers] = useState<PeerRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/polyphony/feed').then(r => r.ok ? r.json() : { feed: [] }),
      fetch('/api/polyphony/peers').then(r => r.ok ? r.json() : { peers: [] }),
    ]).then(([feedData, peersData]) => {
      setFeed(feedData.feed ?? [])
      setPeers(peersData.peers ?? [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-2">Polyphony</h1>
      <p className="text-text-muted text-sm mb-8">
        What your paired Phonolith instances are up to. Manage pairing and sharing in{' '}
        <Link href="/settings" className="text-accent hover:underline">Settings</Link>.
      </p>

      {loading && <p className="text-text-muted text-sm">Loading…</p>}

      {!loading && feed.length === 0 && (
        <p className="text-text-muted text-sm">No paired instances yet — pair one from Settings → Polyphony.</p>
      )}

      <div className="flex flex-col gap-3">
        {feed.map(entry => {
          const peer = peers.find(p => p.id === entry.peerId)
          return (
            <div key={entry.peerId} className="bg-surface-2 border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${entry.online ? 'bg-success' : 'bg-text-muted'}`} />
                  <p className="text-text-primary text-sm font-medium">{entry.name}</p>
                </div>
                {peer?.share_library && (
                  <Link href={`/polyphony/${entry.peerId}/library`} className="text-accent text-xs font-medium hover:underline">
                    Browse library →
                  </Link>
                )}
              </div>
              {entry.nowPlaying ? (
                <p className="text-text-muted text-xs mt-2">
                  ♫ {entry.nowPlaying.title}{entry.nowPlaying.artist ? ` — ${entry.nowPlaying.artist}` : ''}
                </p>
              ) : (
                <p className="text-text-muted text-xs mt-2">Not playing anything right now.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
