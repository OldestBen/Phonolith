'use client'

/**
 * Library-wide "Galaxy" visualization — the whole-library sibling of
 * ArtistViz.tsx. Same physics *approach* (spring/repulsion force sim,
 * canvas draw loop, requestAnimationFrame), but ArtistViz itself is not
 * touched or imported from here; this is a standalone component so the
 * already-audited per-artist page can't regress.
 *
 * Two granularities, toggled by the caller via `granularity`:
 *  - 'artists': one node per artist (cheap — a library's artist count is
 *    always small enough for a direct settle pass).
 *  - 'songs': one node per song, fed from /api/visualize/galaxy/songs,
 *    which already caps itself at a few thousand real rows (see that
 *    route's SONG_LIMIT comment) so the browser never has to lay out an
 *    unbounded node count.
 *
 * Performance safeguard for both modes, but especially 'songs': repulsion
 * uses a spatial hash grid (bucket nodes into cells, only compare against
 * the 3x3 neighbourhood) instead of the naive O(n²) all-pairs pass, and the
 * settle simulation is spread across animation frames (a handful of ticks
 * per frame) rather than run synchronously in one blocking loop. At n=2000
 * a naive O(n²) pass is 2,000,000 pair checks *per tick*, times ~150 ticks
 * to settle — that's the kind of thing that freezes a tab; the grid makes
 * each tick closer to O(n) in practice for a library's natural node
 * density, and spreading ticks across frames means even a slow settle
 * never blocks a single frame for long.
 *
 * Nodes are keyed by the real DB id (`artists.id` or `songs.id`) — never by
 * `genius_id` — for graph/edge matching, same rule ArtistViz documents.
 * `genius_id` is carried separately, only for building the outbound links
 * into the existing real /visualize/[id] and /song/[id] pages.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import type { GalaxyArtistNode } from '@/app/api/visualize/galaxy/artists/route'
import type { LibrarySongNode } from '@/app/api/visualize/galaxy/songs/route'

const PALETTE = [
  '#a78bfa', '#60a5fa', '#34d399', '#f59e0b',
  '#f472b6', '#818cf8', '#22d3ee', '#fb923c', '#a3e635', '#e879f9',
]

// Matches ArtistViz's CONNECTION_COLOURS exactly, for visual consistency
// between the per-artist and library-wide galaxies.
const CONNECTION_COLOURS = {
  collaborator: 'rgba(167, 139, 250, 0.35)',
  producer:     'rgba(56,  189, 248, 0.35)',
  era:          'rgba(244, 114, 182, 0.3)',
}

export type Granularity = 'artists' | 'songs'

export interface GalaxyEdges {
  collaborator: [number, number][]
  producer: [number, number][]
  /** Only ever populated in 'songs' mode — see the artists API route's
   *  comment on why era edges aren't meaningful at artist-cluster scope. */
  era?: [number, number][]
}

interface GNode {
  id: number
  kind: 'artist' | 'song'
  label: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  geniusId: number
  songCount?: number
  ownedCount?: number
  artistId?: number
  artistName?: string
  albumName?: string
  pageviews?: number
  releaseDate?: string
}

export interface LibraryGalaxyFilters {
  showCollaborator: boolean
  showProducer: boolean
  showEra: boolean
}

interface LibraryGalaxyProps {
  granularity: Granularity
  artists: GalaxyArtistNode[]
  songs: LibrarySongNode[]
  edges: GalaxyEdges
  filters: LibraryGalaxyFilters
  onArtistSelect?: (artist: GalaxyArtistNode | null) => void
  onArtistOpen?: (artist: GalaxyArtistNode) => void
  onSongSelect?: (song: LibrarySongNode | null) => void
  onSongOpen?: (song: LibrarySongNode) => void
  onZoomChange?: (zoom: number) => void
}

const TARGET_TICKS = 160
const TICKS_PER_FRAME = 3

function buildArtistNodes(artists: GalaxyArtistNode[], width: number, height: number): GNode[] {
  const cx = width / 2
  const cy = height / 2
  const n = Math.max(1, artists.length)
  return artists.map((a, i) => {
    const turns = Math.max(3, Math.ceil(n / 40))
    const angle = (i / n) * Math.PI * 2 * turns
    const orbit = 30 + (i / n) * Math.min(width, height) * 0.44
    const size = a.owned_count || a.song_count
    return {
      id: a.id,
      kind: 'artist',
      label: a.name,
      color: PALETTE[i % PALETTE.length],
      x: cx + Math.cos(angle) * orbit + (Math.random() - 0.5) * 30,
      y: cy + Math.sin(angle) * orbit + (Math.random() - 0.5) * 30,
      vx: 0, vy: 0,
      radius: Math.max(4, Math.min(24, 4 + Math.sqrt(size) * 2.4)),
      geniusId: a.genius_id,
      songCount: a.song_count,
      ownedCount: a.owned_count,
    }
  })
}

function buildSongNodes(songs: LibrarySongNode[], width: number, height: number): GNode[] {
  const cx = width / 2
  const cy = height / 2
  const artistIdx = new Map<number, number>()
  return songs.map(s => {
    if (!artistIdx.has(s.artist_db_id)) artistIdx.set(s.artist_db_id, artistIdx.size)
    const idx = artistIdx.get(s.artist_db_id)!
    const clusterCount = Math.max(1, artistIdx.size)
    const angle = (idx / clusterCount) * Math.PI * 2 + Math.random() * 0.4
    const orbit = 50 + (idx % 24) * 16
    return {
      id: s.id,
      kind: 'song',
      label: s.title,
      color: PALETTE[idx % PALETTE.length],
      x: cx + Math.cos(angle) * orbit + (Math.random() - 0.5) * 200,
      y: cy + Math.sin(angle) * orbit + (Math.random() - 0.5) * 200,
      vx: 0, vy: 0,
      radius: s.pageviews ? Math.max(2.5, Math.min(7, Math.log10(s.pageviews + 1))) : 3.5,
      geniusId: s.genius_id,
      artistId: s.artist_db_id,
      artistName: s.artist_name,
      albumName: s.album_name,
      pageviews: s.pageviews,
      releaseDate: s.release_date,
    }
  })
}

/** Spatial-hash-partitioned repulsion + gentle center gravity — the
 * performance safeguard described in the module comment above. */
function tick(nodes: GNode[], width: number, height: number) {
  const alpha = 0.3
  const cx = width / 2
  const cy = height / 2
  const cellSize = 46
  const minDist = 22

  const grid = new Map<string, number[]>()
  for (let i = 0; i < nodes.length; i++) {
    const gx = Math.floor(nodes[i].x / cellSize)
    const gy = Math.floor(nodes[i].y / cellSize)
    const key = `${gx},${gy}`
    let bucket = grid.get(key)
    if (!bucket) { bucket = []; grid.set(key, bucket) }
    bucket.push(i)
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const gx = Math.floor(n.x / cellSize)
    const gy = Math.floor(n.y / cellSize)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`)
        if (!bucket) continue
        for (const j of bucket) {
          if (j <= i) continue
          const other = nodes[j]
          const ddx = other.x - n.x
          const ddy = other.y - n.y
          const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1
          const md = Math.max(minDist, (n.radius + other.radius) * 1.8)
          if (dist < md) {
            const force = ((md - dist) / dist) * 0.5 * alpha
            n.vx -= ddx * force
            n.vy -= ddy * force
            other.vx += ddx * force
            other.vy += ddy * force
          }
        }
      }
    }

    n.vx += (cx - n.x) * 0.0015 * alpha
    n.vy += (cy - n.y) * 0.0015 * alpha
    n.vx *= 0.82
    n.vy *= 0.82
    n.x += n.vx
    n.y += n.vy
  }
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save()
  ctx.shadowBlur = 30
  ctx.shadowColor = color
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 12
  ctx.shadowColor = '#ffffff'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.restore()
}

export default function LibraryGalaxy({
  granularity, artists, songs, edges, filters,
  onArtistSelect, onArtistOpen, onSongSelect, onSongOpen, onZoomChange,
}: LibraryGalaxyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<GNode[]>([])
  const animRef = useRef<number>()
  const tickCountRef = useRef(0)
  const settledRef = useRef(false)
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const dragRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null)
  const [selected, setSelected] = useState<GNode | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  const getSize = () => {
    const canvas = canvasRef.current
    return canvas ? { w: canvas.width / window.devicePixelRatio, h: canvas.height / window.devicePixelRatio } : { w: 1200, h: 800 }
  }

  // Rebuild the node set whenever the underlying data or granularity changes.
  useEffect(() => {
    const { w, h } = getSize()
    const nodes = granularity === 'artists'
      ? buildArtistNodes(artists, w, h)
      : buildSongNodes(songs, w, h)
    nodesRef.current = nodes
    tickCountRef.current = 0
    settledRef.current = nodes.length === 0
    setSelected(null)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, artists, songs])

  const idNodeMap = useCallback(() => new Map(nodesRef.current.map(n => [n.id, n])), [])

  const hitTest = useCallback((mouseX: number, mouseY: number) => {
    const { scale, tx, ty } = transformRef.current
    const cx = (mouseX - tx) / scale
    const cy = (mouseY - ty) / scale
    for (const n of [...nodesRef.current].reverse()) {
      const dx = n.x - cx
      const dy = n.y - cy
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 8) return n
    }
    return null
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr

    if (!settledRef.current) {
      for (let k = 0; k < TICKS_PER_FRAME; k++) {
        tick(nodesRef.current, W, H)
        tickCountRef.current++
        if (tickCountRef.current >= TARGET_TICKS) { settledRef.current = true; break }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#08080a'
    ctx.fillRect(0, 0, W, H)

    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    for (let i = 0; i < 100; i++) {
      const sx = (i * 137.508) % W
      const sy = (i * 113.314) % H
      const opacity = 0.2 + (Math.sin(Date.now() / 2000 + i) + 1) * 0.15
      ctx.globalAlpha = opacity
      ctx.beginPath()
      ctx.arc(sx, sy, 0.8, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    const { scale, tx, ty } = transformRef.current
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(scale, scale)

    const nodeMap = idNodeMap()

    const drawConnections = (pairs: [number, number][], color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 0.5
      ctx.setLineDash([3, 6])
      ctx.beginPath()
      for (const [a, b] of pairs) {
        const na = nodeMap.get(a)
        const nb = nodeMap.get(b)
        if (!na || !nb) continue
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (filters.showCollaborator) drawConnections(edges.collaborator, CONNECTION_COLOURS.collaborator)
    if (filters.showProducer) drawConnections(edges.producer, CONNECTION_COLOURS.producer)
    if (filters.showEra && edges.era) drawConnections(edges.era, CONNECTION_COLOURS.era)

    for (const n of nodesRef.current) {
      const isHovered = hoveredId === n.id
      const isSelected = selected?.id === n.id
      if (n.kind === 'artist') {
        drawGlow(ctx, n.x, n.y, n.radius, n.color)
      } else {
        ctx.fillStyle = n.color
        ctx.shadowBlur = isHovered ? 18 : 6
        ctx.shadowColor = n.color
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }

      if (isHovered || isSelected) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.font = '10px var(--font-mono), monospace'
        ctx.textAlign = 'center'
        const label = n.kind === 'artist'
          ? `${n.label.slice(0, 26)} · ${n.ownedCount ?? 0} owned`
          : n.label.slice(0, 28)
        ctx.fillText(label, n.x, n.y - n.radius - 6)
      }
    }

    ctx.restore()
    animRef.current = requestAnimationFrame(draw)
  }, [edges, filters, hoveredId, selected, idNodeMap])

  useEffect(() => {
    if (!ready) return
    animRef.current = requestAnimationFrame(draw)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [draw, ready])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const t = transformRef.current
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.2, Math.min(4, t.scale * delta))
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    t.tx = mx - (mx - t.tx) * (newScale / t.scale)
    t.ty = my - (my - t.ty) * (newScale / t.scale)
    t.scale = newScale
    onZoomChange?.(newScale)
  }, [onZoomChange])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX - transformRef.current.tx, startY: e.clientY - transformRef.current.ty, dragging: false }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      dragRef.current.dragging = true
      transformRef.current.tx = e.clientX - dragRef.current.startX
      transformRef.current.ty = e.clientY - dragRef.current.startY
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    setHoveredId(node?.id ?? null)
    if (canvasRef.current) canvasRef.current.style.cursor = node ? 'pointer' : 'grab'
  }, [hitTest])

  const emitSelection = useCallback((node: GNode | null) => {
    setSelected(node)
    if (granularity === 'artists') {
      const artist = node ? artists.find(a => a.id === node.id) ?? null : null
      onArtistSelect?.(artist)
    } else {
      const song = node ? songs.find(s => s.id === node.id) ?? null : null
      onSongSelect?.(song)
    }
  }, [granularity, artists, songs, onArtistSelect, onSongSelect])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current?.dragging) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) emitSelection(hitTest(e.clientX - rect.left, e.clientY - rect.top))
    }
    dragRef.current = null
  }, [hitTest, emitSelection])

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (!node) return
    if (node.kind === 'artist') {
      const artist = artists.find(a => a.id === node.id)
      if (artist) onArtistOpen?.(artist)
    } else {
      const song = songs.find(s => s.id === node.id)
      if (song) onSongOpen?.(song)
    }
  }, [hitTest, artists, songs, onArtistOpen, onSongOpen])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') emitSelection(null)
  }, [emitSelection])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const nodeCount = nodesRef.current.length
  const totalEdges = edges.collaborator.length + edges.producer.length + (edges.era?.length ?? 0)

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDblClick}
        style={{ cursor: 'grab' }}
      />

      <div className="pointer-events-none absolute left-3.5 top-3 flex flex-col gap-0.5">
        <p className="m-0 text-[10px] uppercase tracking-[.18em] text-text-faint">
          {granularity === 'artists' ? 'Library galaxy · artist clusters' : 'Library galaxy · every song'}
        </p>
        <p className="m-0 text-[9.5px] text-text-ghost">
          {granularity === 'artists'
            ? `${artists.length.toLocaleString()} artist node${artists.length === 1 ? '' : 's'} · ${totalEdges.toLocaleString()} edges`
            : `${songs.length.toLocaleString()} song node${songs.length === 1 ? '' : 's'} · ${totalEdges.toLocaleString()} edges`}
        </p>
      </div>

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-text-muted text-sm animate-pulse">Building galaxy…</div>
        </div>
      )}
      {ready && nodeCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-text-muted text-sm">
            {granularity === 'artists' ? 'No indexed artists yet.' : 'No indexed songs yet.'}
          </div>
        </div>
      )}
    </div>
  )
}
