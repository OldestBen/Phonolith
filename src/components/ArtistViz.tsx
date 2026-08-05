'use client'

/**
 * Real force-directed "galaxy" visualization for an artist's discography.
 *
 * Nodes are keyed by `songs.id` (the internal DB id) throughout — never by
 * `genius_id` — because that's the id space the connections API's edge lists
 * (`collaborator`/`producer`/`era`) actually reference. `genius_id` is only
 * ever used for building an outbound link to Genius, never for graph/edge
 * matching.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import type { VizConnections } from '@/lib/types'

const PALETTE = [
  '#a78bfa', '#60a5fa', '#34d399', '#f59e0b',
  '#f472b6', '#818cf8', '#22d3ee', '#fb923c', '#a3e635', '#e879f9',
]

// Matches the mockup's `drawGalaxy` edge-color map exactly (collab = VL
// violet, producer = sky, era = pink) — see Phonolith.dc.html line ~1803.
const CONNECTION_COLOURS = {
  album:        'rgba(167, 139, 250, 0.25)',
  collaborator: 'rgba(167, 139, 250, 0.35)',
  producer:     'rgba(56,  189, 248, 0.35)',
  era:          'rgba(244, 114, 182, 0.3)',
}

export type ViewMode = 'galaxy' | 'timeline' | 'lanes'

// Matches the mockup's `galaxyViews` list exactly — all three modes are real,
// each backed by the same real per-song/per-album data (release_date, album
// grouping, song counts); "Swim-lanes" reinterprets the mockup's "one lane
// per artist" as "one lane per album" since this screen is scoped to a
// single artist, not the library-wide multi-artist view the mockup shows.
const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'galaxy', label: 'Galaxy' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'lanes', label: 'Swim-lanes' },
]

export interface SongData {
  id: number
  genius_id: number
  title: string
  release_date?: string
  pageviews?: number
  song_art_image_url?: string
  album_db_id?: number
  album_genius_id?: number
  album_name?: string
  album_cover_art_url?: string
}

export interface VizFilters {
  showCollaborator: boolean
  showProducer: boolean
  showEra: boolean
  /** 'all' or a decade label like '1990s', derived from real release_date data. */
  decadeFilter: string
  viewMode: ViewMode
}

/** Shared so the page and the sidebar can build a real decade-chip list from actual data. */
export function decadeOf(dateStr?: string): string | null {
  if (!dateStr) return null
  const year = new Date(dateStr).getFullYear()
  if (Number.isNaN(year)) return null
  return `${Math.floor(year / 10) * 10}s`
}

interface Node {
  id: number
  type: 'album' | 'song'
  label: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  albumIdx?: number
  albumId?: number
  pageviews?: number
  releaseDate?: string
  geniusId?: number
  /** Timeline/lanes mode only: the x position implied by release year. */
  targetX?: number
  /** Album nodes only: real count of songs in the album — drives node/block size. */
  songCount?: number
}

interface ArtistVizProps {
  songs: SongData[]
  connections: VizConnections
  filters: VizFilters
  onSongSelect?: (song: SongData | null) => void
  onAlbumSelect?: (album: string | null) => void
  onZoomChange?: (zoom: number) => void
  onViewModeChange?: (mode: ViewMode) => void
}

function buildNodes(songs: SongData[], width: number, height: number, viewMode: ViewMode): Node[] {
  const albumMap = new Map<number | string, number>()
  const albumNodes: Node[] = []
  const songNodes: Node[] = []

  const cx = width / 2
  const cy = height / 2

  // Timeline and swim-lanes both lay nodes out along a real release-year
  // x-axis, one row per album — they only differ in how a node is *drawn*.
  const laneLayout = viewMode === 'timeline' || viewMode === 'lanes'

  let minYear = Infinity
  let maxYear = -Infinity
  if (laneLayout) {
    for (const s of songs) {
      const y = s.release_date ? new Date(s.release_date).getFullYear() : NaN
      if (!Number.isNaN(y)) {
        minYear = Math.min(minYear, y)
        maxYear = Math.max(maxYear, y)
      }
    }
    if (!Number.isFinite(minYear)) { minYear = 2000; maxYear = 2000 }
  }
  const margin = 60
  const yearX = (y: number) => margin + ((y - minYear) / Math.max(1, maxYear - minYear)) * (width - margin * 2)

  // Real per-album song counts — drives node/block sizing, matching the
  // mockup's `rr = base + al.songs * k` sizing in drawGalaxy/drawTimeline/drawLanes.
  const songCounts = new Map<number, number>()
  for (const song of songs) {
    const albumKey = song.album_db_id ?? song.album_name ?? '__singles__'
    const idx = albumMap.get(albumKey) ?? albumMap.size
    if (!albumMap.has(albumKey)) albumMap.set(albumKey, idx)
    songCounts.set(idx, (songCounts.get(idx) ?? 0) + 1)
  }
  albumMap.clear()

  for (const song of songs) {
    const albumKey = song.album_db_id ?? song.album_name ?? '__singles__'
    if (!albumMap.has(albumKey)) {
      const idx = albumMap.size
      albumMap.set(albumKey, idx)
      const angle = (idx / Math.max(1, 8)) * Math.PI * 2
      const count = songCounts.get(idx) ?? 1
      albumNodes.push({
        id: song.album_db_id ?? -(idx + 1),
        type: 'album',
        label: song.album_name ?? 'Singles',
        color: PALETTE[idx % PALETTE.length],
        x: laneLayout
          ? cx + (Math.random() - 0.5) * 40
          : cx + Math.cos(angle) * 200 + (Math.random() - 0.5) * 40,
        y: laneLayout
          ? 60 + (idx % 12) * ((height - 120) / 12) + (Math.random() - 0.5) * 10
          : cy + Math.sin(angle) * 200 + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0,
        radius: Math.max(10, Math.min(30, 10 + count * 0.6)),
        albumIdx: idx,
        songCount: count,
      })
    }

    const albumIdx = albumMap.get(albumKey)!
    const angle = Math.random() * Math.PI * 2
    const year = song.release_date ? new Date(song.release_date).getFullYear() : NaN
    const hasYear = laneLayout && !Number.isNaN(year)

    songNodes.push({
      id: song.id,
      type: 'song',
      label: song.title,
      color: PALETTE[albumIdx % PALETTE.length],
      x: hasYear
        ? yearX(year) + (Math.random() - 0.5) * 20
        : cx + Math.cos(angle) * (180 + albumIdx * 20) + (Math.random() - 0.5) * 60,
      y: laneLayout
        ? (albumNodes[albumIdx]?.y ?? cy) + (Math.random() - 0.5) * 50
        : cy + Math.sin(angle) * (180 + albumIdx * 20) + (Math.random() - 0.5) * 60,
      vx: 0, vy: 0,
      radius: 5,
      albumIdx,
      albumId: song.album_db_id ?? -(albumIdx + 1),
      pageviews: song.pageviews,
      releaseDate: song.release_date,
      geniusId: song.genius_id,
      targetX: hasYear ? yearX(year) : undefined,
    })
  }

  return [...albumNodes, ...songNodes]
}

function tick(nodes: Node[], albumNodes: Node[], width: number, height: number, viewMode: ViewMode) {
  const alpha = 0.3
  const cx = width / 2
  const cy = height / 2

  // Charge repulsion between all nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x
      const dy = nodes[j].y - nodes[i].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const minDist = nodes[i].type === 'album' || nodes[j].type === 'album' ? 120 : 18
      if (dist < minDist) {
        const force = ((minDist - dist) / dist) * 0.5 * alpha
        nodes[i].vx -= dx * force
        nodes[i].vy -= dy * force
        nodes[j].vx += dx * force
        nodes[j].vy += dy * force
      }
    }

    const n = nodes[i]
    const laneLayout = viewMode === 'timeline' || viewMode === 'lanes'

    if (laneLayout) {
      if (n.type === 'song') {
        if (n.targetX !== undefined) {
          n.vx += (n.targetX - n.x) * 0.02 * alpha
        }
        const album = albumNodes.find(a => a.id === n.albumId)
        if (album) n.vy += (album.y - n.y) * 0.01 * alpha
      }
    } else {
      // Song spring toward album
      if (n.type === 'song' && n.albumId !== undefined) {
        const album = albumNodes.find(a => a.id === n.albumId)
        if (album) {
          const dx = album.x - n.x
          const dy = album.y - n.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const targetDist = 80
          const force = ((dist - targetDist) / dist) * 0.08 * alpha
          n.vx += dx * force
          n.vy += dy * force
        }
      }
      // Center gravity (galaxy mode only — timeline/lanes use the year/album springs above)
      if (n.type === 'album') {
        n.vx += (cx - n.x) * 0.002 * alpha
        n.vy += (cy - n.y) * 0.002 * alpha
      }
    }

    // Damping + apply
    n.vx *= 0.8
    n.vy *= 0.8
    n.x += n.vx
    n.y += n.vy
  }
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save()
  ctx.shadowBlur = 38
  ctx.shadowColor = color
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 16
  ctx.shadowColor = '#ffffff'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.restore()
}

export default function ArtistViz({
  songs, connections, filters, onSongSelect, onAlbumSelect, onZoomChange, onViewModeChange,
}: ArtistVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<Node[]>([])
  const albumNodesRef = useRef<Node[]>([])
  const animRef = useRef<number>()
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const dragRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null)
  const [selected, setSelected] = useState<Node | null>(null)
  const [focusAlbumId, setFocusAlbumId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [initialized, setInitialized] = useState(false)

  const getSize = () => {
    const canvas = canvasRef.current
    return canvas ? { w: canvas.width / window.devicePixelRatio, h: canvas.height / window.devicePixelRatio } : { w: 1200, h: 800 }
  }

  const filteredSongs = useMemo(() => (
    filters.decadeFilter === 'all'
      ? songs
      : songs.filter(s => decadeOf(s.release_date) === filters.decadeFilter)
  ), [songs, filters.decadeFilter])

  // Build and simulate whenever the visible song set or layout mode changes
  useEffect(() => {
    if (!filteredSongs.length) { nodesRef.current = []; albumNodesRef.current = []; setInitialized(true); return }
    const { w, h } = getSize()
    const nodes = buildNodes(filteredSongs, w, h, filters.viewMode)
    const albumNodes = nodes.filter(n => n.type === 'album')
    nodesRef.current = nodes
    albumNodesRef.current = albumNodes

    // Pre-compute 200 ticks
    for (let i = 0; i < 200; i++) tick(nodes, albumNodes, w, h, filters.viewMode)
    setInitialized(true)
  }, [filteredSongs, filters.viewMode])

  const getSongById = useCallback((nodeId: number) =>
    songs.find(s => s.id === nodeId), [songs])

  const hitTest = useCallback((mouseX: number, mouseY: number) => {
    const { scale, tx, ty } = transformRef.current
    const cx = (mouseX - tx) / scale
    const cy = (mouseY - ty) / scale
    for (const n of [...nodesRef.current].reverse()) {
      if (filters.viewMode === 'lanes') {
        if (n.type === 'song') continue // not drawn/clickable in lanes mode
        if (n.type === 'album') {
          const bw = Math.max(24, (n.songCount ?? 1) * 4.4)
          const bh = 16
          if (cx >= n.x - 6 && cx <= n.x + bw + 6 && cy >= n.y - bh / 2 - 6 && cy <= n.y + bh / 2 + 6) return n
          continue
        }
      }
      const dx = n.x - cx
      const dy = n.y - cy
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 8) return n
    }
    return null
  }, [filters.viewMode])

  // Draw loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#08080a'
    ctx.fillRect(0, 0, W, H)

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    for (let i = 0; i < 80; i++) {
      const sx = ((i * 137.508) % W)
      const sy = ((i * 113.314) % H)
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

    const nodes = nodesRef.current
    const songNodeMap = new Map(nodes.filter(n => n.type === 'song').map(n => [n.id, n]))

    // Connection lines
    const drawConnections = (pairs: [number, number][], color: string, dashed = false) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 0.5
      if (dashed) ctx.setLineDash([3, 6])
      else ctx.setLineDash([])
      ctx.beginPath()
      for (const [a, b] of pairs) {
        const na = songNodeMap.get(a)
        const nb = songNodeMap.get(b)
        if (!na || !nb) continue
        const aOpacity = focusAlbumId !== null && na.albumId !== focusAlbumId ? 0.05 : 1
        if (aOpacity < 0.1) continue
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Spider-web overlays (structural song→album lines + collaborator/producer/
    // era edges) are a Galaxy-mode concept only — the mockup's drawTimeline/
    // drawLanes never render them either, since a year-axis or block chart
    // has no meaningful "edge" to draw.
    if (filters.viewMode === 'galaxy') {
      for (const n of nodes.filter(n => n.type === 'song')) {
        const album = albumNodesRef.current.find(a => a.id === n.albumId)
        if (!album) continue
        const opacity = focusAlbumId !== null && n.albumId !== focusAlbumId ? 0.03 : 0.12
        ctx.strokeStyle = `rgba(167,139,250,${opacity})`
        ctx.lineWidth = 0.5
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        ctx.moveTo(n.x, n.y)
        ctx.lineTo(album.x, album.y)
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (filters.showCollaborator) drawConnections(connections.collaborator as [number, number][], CONNECTION_COLOURS.collaborator, true)
      if (filters.showProducer) drawConnections(connections.producer as [number, number][], CONNECTION_COLOURS.producer, true)
      if (filters.showEra) drawConnections(connections.era as [number, number][], CONNECTION_COLOURS.era, false)
    }

    // Nodes
    for (const n of nodes) {
      if (filters.viewMode === 'lanes' && n.type === 'song') continue // lanes mode shows album blocks only, matching the mockup's drawLanes

      const isFocused = focusAlbumId === null || n.albumId === focusAlbumId || (n.type === 'album' && n.id === focusAlbumId)
      const opacity = focusAlbumId !== null && !isFocused ? 0.05 : 1
      ctx.globalAlpha = opacity

      if (n.type === 'album') {
        if (filters.viewMode === 'lanes') {
          // Block width = real per-album song count (matches mockup's
          // `bw = Math.max(24, al.songs * 4.4)` in drawLanes exactly).
          const bw = Math.max(24, (n.songCount ?? 1) * 4.4)
          const bh = 16
          const focus = focusAlbumId === n.id
          const grad = ctx.createLinearGradient(n.x, n.y - bh / 2, n.x + bw, n.y + bh / 2)
          grad.addColorStop(0, focus ? 'rgba(255,179,64,.9)' : 'rgba(109,40,217,.9)')
          grad.addColorStop(1, focus ? 'rgba(255,179,64,.4)' : 'rgba(167,139,250,.6)')
          ctx.fillStyle = grad
          if (focus) { ctx.shadowColor = '#ffb340'; ctx.shadowBlur = 16 }
          ctx.beginPath()
          ctx.roundRect(n.x, n.y - bh / 2, bw, bh, 3)
          ctx.fill()
          ctx.shadowBlur = 0
          // Decorative sweep mark — purely cosmetic scan animation, not a data value.
          const sweepX = n.x + ((performance.now() / 1000 * 0.22 + (n.albumIdx ?? 0) * 0.13) % 1) * bw
          ctx.fillStyle = 'rgba(233,213,255,.55)'
          ctx.fillRect(sweepX, n.y - bh / 2, 1.5, bh)

          if (hoveredId === n.id || selected?.id === n.id || focus) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)'
            ctx.font = '10px var(--font-mono), monospace'
            ctx.textAlign = 'left'
            ctx.fillText(`${n.label.slice(0, 24)} · ${n.songCount ?? 0} songs`, n.x, n.y - bh / 2 - 6)
          }
        } else {
          drawGlow(ctx, n.x, n.y, n.radius, n.color)

          if (hoveredId === n.id || selected?.id === n.id || focusAlbumId === n.id) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)'
            ctx.font = '11px var(--font-mono), monospace'
            ctx.textAlign = 'center'
            ctx.fillText(n.label.slice(0, 24), n.x, n.y - n.radius - 6)
          }
        }
      } else {
        const r = n.pageviews ? Math.max(3, Math.min(8, Math.log10(n.pageviews + 1))) : 4
        ctx.fillStyle = n.color
        ctx.shadowBlur = hoveredId === n.id ? 20 : 8
        ctx.shadowColor = n.color
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0

        if (hoveredId === n.id || selected?.id === n.id) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.font = '10px var(--font-mono), monospace'
          ctx.textAlign = 'center'
          ctx.fillText(n.label.slice(0, 28), n.x, n.y - r - 5)
        }
      }
      ctx.globalAlpha = 1
    }

    ctx.restore()
    animRef.current = requestAnimationFrame(draw)
  }, [connections, filters, focusAlbumId, hoveredId, selected])

  useEffect(() => {
    if (!initialized) return
    animRef.current = requestAnimationFrame(draw)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [draw, initialized])

  // Canvas resize
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

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const t = transformRef.current
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.3, Math.min(3, t.scale * delta))
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    t.tx = mx - (mx - t.tx) * (newScale / t.scale)
    t.ty = my - (my - t.ty) * (newScale / t.scale)
    t.scale = newScale
    onZoomChange?.(newScale)
  }, [onZoomChange])

  // Mouse events
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
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? 'pointer' : 'grab'
    }
  }, [hitTest])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current?.dragging) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const node = hitTest(e.clientX - rect.left, e.clientY - rect.top)
      if (node) {
        setSelected(node)
        if (node.type === 'song') {
          onSongSelect?.(getSongById(node.id) ?? null)
          onAlbumSelect?.(null)
        } else {
          onAlbumSelect?.(node.label)
          onSongSelect?.(null)
        }
      } else {
        setSelected(null)
        onSongSelect?.(null)
        onAlbumSelect?.(null)
      }
    }
    dragRef.current = null
  }, [hitTest, getSongById, onSongSelect, onAlbumSelect])

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (node?.type === 'album') {
      setFocusAlbumId(prev => prev === node.id ? null : node.id)
    }
  }, [hitTest])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setFocusAlbumId(null)
      setSelected(null)
      onSongSelect?.(null)
      onAlbumSelect?.(null)
    }
  }, [onSongSelect, onAlbumSelect])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const albumCount = useMemo(() => (
    new Set(filteredSongs.map(s => s.album_db_id ?? s.album_name ?? '__singles__')).size
  ), [filteredSongs])
  const totalEdges = connections.collaborator.length + connections.producer.length + connections.era.length

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

      {/* Corner label */}
      <div className="pointer-events-none absolute left-3.5 top-3 flex flex-col gap-0.5">
        <p className="m-0 text-[10px] uppercase tracking-[.18em] text-text-faint">Force-directed galaxy</p>
        <p className="m-0 text-[9.5px] text-text-ghost">
          {albumCount.toLocaleString()} album node{albumCount === 1 ? '' : 's'} · {filteredSongs.length.toLocaleString()} song node{filteredSongs.length === 1 ? '' : 's'} · {totalEdges.toLocaleString()} edges · sim 60 Hz
        </p>
      </div>

      {/* View-mode cluster — matches the mockup's galaxyViews style exactly
          (translucent purple pill, not a solid fill) */}
      <div className="absolute right-3.5 bottom-3 flex gap-1.5">
        {VIEW_MODES.map(({ key, label }) => {
          const on = filters.viewMode === key
          return (
            <button
              key={key}
              onClick={() => onViewModeChange?.(key)}
              className="rounded-md px-2.5 py-[3px] text-[10px] font-medium transition-colors"
              style={{
                border: `1px solid ${on ? '#7c3aed' : '#27272a'}`,
                background: on ? 'rgba(109,40,217,.3)' : 'rgba(16,16,18,.8)',
                color: on ? '#c4b5fd' : '#a1a1aa',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {focusAlbumId !== null && (
        <button
          onClick={() => setFocusAlbumId(null)}
          className="absolute top-3 right-3.5 px-3 py-1.5 rounded-lg border border-border bg-surface/80
                     backdrop-blur-sm text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          Exit Focus
        </button>
      )}
      {!initialized && filteredSongs.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-text-muted text-sm">Building visualization…</div>
        </div>
      )}
      {initialized && filteredSongs.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-text-muted text-sm">No songs match the current filters.</div>
        </div>
      )}
    </div>
  )
}
