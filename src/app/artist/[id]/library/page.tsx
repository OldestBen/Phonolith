'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Artist, LibraryFile } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function DrScore({ score }: { score?: number }) {
  if (score == null) return <span className="text-text-muted">—</span>
  const cls =
    score > 12 ? 'text-success' : score >= 8 ? 'text-warning' : 'text-danger'
  return <span className={`font-mono ${cls}`}>{score}</span>
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ArtistLibraryPage() {
  const { id } = useParams<{ id: string }>()
  const [artist, setArtist] = useState<Artist | null>(null)
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [artistRes, filesRes] = await Promise.all([
          fetch(`/api/artist/${id}`),
          fetch('/api/library'),
        ])

        if (artistRes.ok) {
          const d = await artistRes.json()
          const fetchedArtist: Artist = d.artist ?? d
          setArtist(fetchedArtist)

          if (filesRes.ok) {
            const filesData = await filesRes.json()
            const allFiles: LibraryFile[] = filesData.files ?? filesData ?? []
            // Filter files whose song_artist matches the artist name (case-insensitive)
            const artistName = fetchedArtist.name.toLowerCase()
            const matched = allFiles.filter(
              f => f.song_artist && f.song_artist.toLowerCase().includes(artistName)
            )
            setFiles(matched)
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20 md:pb-8">
      {/* Back link */}
      <Link
        href={`/artist/${id}`}
        className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-accent
                   transition-colors mb-6 group"
      >
        <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
        Back to {artist?.name ?? 'Artist'}
      </Link>

      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-text-primary text-xl font-bold">
          {artist ? `${artist.name} — Library` : 'Artist Library'}
        </h1>
        {!loading && (
          <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted text-xs">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-surface-2 rounded" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-text-muted text-base mb-2">
            No library files matched to {artist?.name ?? 'this artist'}.
          </p>
          <p className="text-text-muted text-sm mb-6">
            Try scanning your library or match files via AcoustID.
          </p>
          <Link
            href="/library"
            className="px-4 py-2 rounded-lg bg-surface border border-border text-text-muted text-sm
                       hover:text-text-primary hover:border-accent/40 transition-colors"
          >
            Open Library →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-text-muted font-medium py-2 pr-4">File</th>
                <th className="text-left text-text-muted font-medium py-2 pr-4">Format</th>
                <th className="text-left text-text-muted font-medium py-2 pr-4">DR</th>
                <th className="text-left text-text-muted font-medium py-2 pr-4">Matched</th>
                <th className="text-left text-text-muted font-medium py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr
                  key={file.blake3_hash}
                  className="border-b border-border/50 hover:bg-surface-2 transition-colors"
                >
                  <td className="py-2.5 pr-4 font-mono text-xs text-text-primary max-w-xs truncate">
                    {basename(file.file_path)}
                  </td>
                  <td className="py-2.5 pr-4 text-text-muted">
                    {file.format?.toUpperCase() ?? '—'}
                    {file.bit_depth && file.sample_rate
                      ? ` ${file.bit_depth}/${Math.round(file.sample_rate / 1000)}`
                      : ''}
                  </td>
                  <td className="py-2.5 pr-4">
                    <DrScore score={file.dr_score} />
                  </td>
                  <td className="py-2.5 pr-4">
                    {file.song_title ? (
                      <span className="text-success text-xs">✓ {file.song_title}</span>
                    ) : (
                      <span className="text-text-muted text-xs">Unmatched</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <Link
                      href={`/library/${file.blake3_hash}`}
                      className="text-xs text-text-muted hover:text-accent transition-colors"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
