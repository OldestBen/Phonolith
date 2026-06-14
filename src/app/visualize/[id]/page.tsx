'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Artist, Song, VizConnections } from '@/lib/types'

// ── Filter state ──────────────────────────────────────────────────────────────
export interface ActiveFilters {
  showCollaborator: boolean
  showProducer: boolean
  showEra: boolean
  minPageviews: number
}

// ── VizControls panel ─────────────────────────────────────────────────────────
function VizControls({
  filters,
  onChange,
  songCount,
}: {
  filters: ActiveFilters
  onChange: (f: ActiveFilters) => void
  songCount: number
}) {
  return (
    <div className="w-56 h-full bg-surface border-r border-border flex flex-col gap-4 p-4 overflow-y-auto">
      <div>
        <p className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">Connections</p>
        {(
          [
            { key: 'showCollaborator' as const, label: 'Collaborator' },
            { key: 'showProducer' as const, label: 'Producer' },
            { key: 'showEra' as const, label: 'Era' },
          ]
        ).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={filters[key] as boolean}
              onChange={e => onChange({ ...filters, [key]: e.target.checked })}
              className="accent-accent w-3.5 h-3.5"
            />
            <span className="text-text-primary text-sm">{label}</span>
          </label>
        ))}
      </div>

      <div>
        <p className="text-text-muted text-xs uppercase tracking-widest mb-2 font-medium">
          Min. Pageviews
        </p>
        <input
          type="range"
          min={0}
          max={10000}
          step={500}
          value={filters.minPageviews}
          onChange={e => onChange({ ...filters, minPageviews: Number(e.target.value) })}
          className="w-full accent-accent"
        />
        <span className="text-text-muted text-xs mt-1 block">
          {filters.minPageviews === 0 ? 'All songs' : `≥ ${filters.minPageviews.toLocaleString()}`}
        </span>
      </div>

      <div className="mt-auto pt-4 border-t border-border">
        <p className="text-text-muted text-xs">{songCount} node{songCount !== 1 ? 's' : ''}</p>
      </div>
    </div>
  )
}

// ── Node type ─────────────────────────────────────────────────────────────────
interface NodeData {
  id: number
  label: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
}

// ── ArtistViz canvas ──────────────────────────────────────────────────────────
function ArtistViz({
  songs,
  connections,
  filters,
}: {
  songs: Song[]
  connections: VizConnections | null
  filters: ActiveFilters
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const nodesRef = useRef<NodeData[]>([])

  // Build nodes whenever songs/filters change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const w = canvas.offsetWidth || 800
    const h = canvas.offsetHeight || 600
    const visibleSongs = songs.filter(s => (s.pageviews ?? 0) >= filters.minPageviews)

    nodesRef.current = visibleSongs.map(s => ({
      id: s.genius_id,
      label: s.title,
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: Math.max(4, Math.min(18, 4 + ((s.pageviews ?? 0) / 5000))),
      color: s.album_name ? '#a78bfa' : '#60a5fa',
    }))
  }, [songs, filters.minPageviews])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#08080a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const nodes = nodesRef.current
      const idxMap = new Map(nodes.map((n, i) => [n.id, i]))

      // Draw connections
      if (connections) {
        const drawEdges = (pairs: [number, number][], color: string) => {
          ctx.strokeStyle = color
          ctx.lineWidth = 0.6
          ctx.globalAlpha = 0.35
          for (const [a, b] of pairs) {
            const na = nodes[idxMap.get(a) ?? -1]
            const nb = nodes[idxMap.get(b) ?? -1]
            if (!na || !nb) continue
            ctx.beginPath()
            ctx.moveTo(na.x, na.y)
            ctx.lineTo(nb.x, nb.y)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
        if (filters.showCollaborator) drawEdges(connections.collaborator, '#a78bfa')
        if (filters.showProducer) drawEdges(connections.producer, '#34d399')
        if (filters.showEra) drawEdges(connections.era, '#f59e0b')
      }

      // Draw nodes
      for (const node of nodes) {
        // Simple physics: drift + bounce
        node.x += node.vx
        node.y += node.vy
        if (node.x < node.radius || node.x > canvas.width - node.radius) node.vx *= -1
        if (node.y < node.radius || node.y > canvas.height - node.radius) node.vy *= -1

        // Glow
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 2.5)
        grd.addColorStop(0, node.color + '44')
        grd.addColorStop(1, 'transparent')
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = grd
        ctx.fill()

        // Circle
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
        ctx.fillStyle = node.color
        ctx.fill()
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [connections, filters])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ background: '#08080a' }}
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VisualizePage() {
  const { id } = useParams<{ id: string }>()
  const [artist, setArtist] = useState<Artist | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [connections, setConnections] = useState<VizConnections | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<ActiveFilters>({
    showCollaborator: true,
    showProducer: true,
    showEra: false,
    minPageviews: 0,
  })

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [artistRes, songsRes, connRes] = await Promise.all([
          fetch(`/api/artist/${id}`),
          fetch(`/api/visualize/${id}`),
          fetch(`/api/visualize/${id}/connections`),
        ])
        if (artistRes.ok) {
          const d = await artistRes.json()
          setArtist(d.artist ?? d)
        }
        if (songsRes.ok) {
          const d = await songsRes.json()
          setSongs(d.songs ?? d)
        }
        if (connRes.ok) {
          const d = await connRes.json()
          setConnections(d.connections ?? d)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const visibleCount = songs.filter(s => (s.pageviews ?? 0) >= filters.minPageviews).length

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background -ml-16">
      {/* Controls panel */}
      <div className="absolute top-0 left-0 h-full z-10">
        <VizControls
          filters={filters}
          onChange={setFilters}
          songCount={visibleCount}
        />
      </div>

      {/* Canvas area */}
      <div className="absolute inset-0 ml-56">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-text-muted text-sm animate-pulse">Loading visualization…</div>
          </div>
        ) : (
          <ArtistViz songs={songs} connections={connections} filters={filters} />
        )}
      </div>

      {/* Back link + artist name */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
        {artist && (
          <span className="text-text-muted text-sm font-medium">{artist.name}</span>
        )}
        <Link
          href={`/artist/${id}`}
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs
                     font-medium hover:bg-surface-2 transition-colors"
        >
          ← Back
        </Link>
      </div>
    </div>
  )
}
