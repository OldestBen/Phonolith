'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { VizConnections } from '@/lib/types'

const PALETTE = [
  '#a78bfa', '#60a5fa', '#34d399', '#f59e0b',
  '#f472b6', '#818cf8', '#22d3ee', '#fb923c', '#a3e635', '#e879f9',
]

const CONNECTION_COLOURS = {
  album:        'rgba(167, 139, 250, 0.25)',
  collaborator: 'rgba(96,  165, 250, 0.35)',
  producer:     'rgba(245, 158, 11,  0.35)',
  era:          'rgba(52,  211, 153, 0.25)',
}

interface SongData {
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
}

interface VizFilters {
  showAlbum: boolean
  showCollaborator: boolean
  showProducer: boolean
  showEra: boolean
  albumFilter: string
  decadeFilter: string
  viewMode: 'galaxy' | 'timeline'
}

interface ArtistVizProps {
  songs: SongData[]
  connections: VizConnections
  filters: VizFilters
  onSongSelect?: (song: SongData | null) => void
  onAlbumSelect?: (album: string | null) => void
}

function buildNodes(songs: SongData[], width: number, height: number): Node[] {
  const albumMap = new Map<number | string, number>()
  const albumNodes: Node[] = []
  const songNodes: Node[] = []

  const cx = width / 2
  const cy = height / 2

  for (const song of songs) {
    const albumKey = song.album_db_id ?? song.album_name ?? '__singles__'
    if (!albumMap.has(albumKey)) {
      const idx = albumMap.size
      albumMap.set(albumKey, idx)
      const angle = (idx / Math.max(1, 8)) * Math.PI * 2
      albumNodes.push({
        id: song.album_db_id ?? -(idx + 1),
        type: 'album',
        label: song.album_name ?? 'Singles',
        color: PALETTE[idx % PALETTE.length],
        x: cx + Math.cos(angle) * 200 + (Math.random() - 0.5) * 40,
        y: cy + Math.sin(angle) * 200 + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0,
        radius: 16,
        albumIdx: idx,
      })
    }

    const albumIdx = albumMap.get(albumKey)!
    const angle = Math.random() * Math.PI * 2
    songNodes.push({
      id: song.id,
      type: 'song',
      label: song.title,
      color: PALETTE[albumIdx % PALETTE.length],
      x: cx + Math.cos(angle) * (180 + albumIdx * 20) + (Math.random() - 0.5) * 60,
      y: cy + Math.sin(angle) * (180 + albumIdx * 20) + (Math.random() - 0.5) * 60,
      vx: 0, vy: 0,
      radius: 5,
      albumIdx,
      albumId: song.album_db_id ?? -(albumIdx + 1),
      pageviews: song.pageviews,
      releaseDate: song.release_date,
      geniusId: song.genius_id,
    })
  }

  return [...albumNodes, ...songNodes]
}

function tick(nodes: Node[], albumNodes: Node[], width: number, height: number) {
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

    // Song spring toward album
    const n = nodes[i]
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

    // Center gravity
    if (n.type === 'album') {
      n.vx += (cx - n.x) * 0.002 * alpha
      n.vy += (cy - n.y) * 0.002 * alpha
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

export default function ArtistViz({ songs, connections, filters, onSongSelect, onAlbumSelect }: ArtistVizProps) {
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

  // Build and simulate on songs change
  useEffect(() => {
    if (!songs.length) return
    const { w, h } = getSize()
    const nodes = buildNodes(songs, w, h)
    const albumNodes = nodes.filter(n => n.type === 'album')
    nodesRef.current = nodes
    albumNodesRef.current = albumNodes

    // Pre-compute 200 ticks
    for (let i = 0; i < 200; i++) tick(nodes, albumNodes, w, h)
    setInitialized(true)
  }, [songs])

  const getSongById = useCallback((nodeId: number) =>
    songs.find(s => s.id === nodeId), [songs])

  const getAlbumById = useCallback((nodeId: number) =>
    songs.find(s => s.album_db_id === nodeId || (nodeId < 0 && !s.album_db_id)), [songs])

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

  const toCanvas = useCallback((cx: number, cy: number) => {
    const { scale, tx, ty } = transformRef.current
    return { x: cx * scale + tx, y: cy * scale + ty }
  }, [])

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

    if (filters.showAlbum) {
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
    }

    if (filters.showCollaborator) drawConnections(connections.collaborator as [number,number][], CONNECTION_COLOURS.collaborator, true)
    if (filters.showProducer) drawConnections(connections.producer as [number,number][], CONNECTION_COLOURS.producer, true)
    if (filters.showEra) drawConnections(connections.era as [number,number][], CONNECTION_COLOURS.era, false)

    // Nodes
    for (const n of nodes) {
      const isFocused = focusAlbumId === null || n.albumId === focusAlbumId || n.type === 'album' && n.id === focusAlbumId
      const opacity = focusAlbumId !== null && !isFocused ? 0.05 : 1
      ctx.globalAlpha = opacity

      if (n.type === 'album') {
        if (focusAlbumId !== null && n.id !== focusAlbumId) {
          ctx.globalAlpha = 0.05
        }
        drawGlow(ctx, n.x, n.y, n.radius, n.color)

        if (hoveredId === n.id || selected?.id === n.id || focusAlbumId === n.id) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.font = '11px system-ui'
          ctx.textAlign = 'center'
          ctx.fillText(n.label.slice(0, 24), n.x, n.y - n.radius - 6)
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
          ctx.font = '10px system-ui'
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
  }, [])

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

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDblClick}
        style={{ cursor: 'grab' }}
      />
      {focusAlbumId !== null && (
        <button
          onClick={() => setFocusAlbumId(null)}
          className="absolute top-4 right-4 px-3 py-1.5 rounded-lg border border-border bg-surface/80
                     backdrop-blur-sm text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          Exit Focus
        </button>
      )}
      {!initialized && songs.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-text-muted text-sm">Building visualization…</div>
        </div>
      )}
    </div>
  )
}
