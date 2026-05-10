import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWaveform } from '../lib/api'

interface Props {
  hash: string
  height?: number
  className?: string
  // 0–1 playback position; undefined = no scrubber shown
  position?: number
  // called when user clicks to seek (0–1 fraction)
  onSeek?: (position: number) => void
}

export default function WaveformViewer({
  hash,
  height = 64,
  className = '',
  position,
  onSeek,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['waveform', hash],
    queryFn: () => getWaveform(hash),
    retry: false,
    staleTime: Infinity,
  })

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onSeek || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(fraction)
  }

  if (isLoading) {
    return (
      <div
        className={`animate-pulse rounded bg-zinc-800 ${className}`}
        style={{ height }}
      />
    )
  }

  if (!data) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-zinc-900 ${className}`}
        style={{ height }}
      >
        <span className="text-[10px] text-zinc-700 font-mono">waveform pending</span>
      </div>
    )
  }

  const { peaks, rms } = data
  const n = peaks.length
  const svgW = n
  const svgH = height
  const mid = svgH / 2

  const peakTop = peaks.map((v, i) => `${i},${mid - v * mid}`).join(' ')
  const peakBot = [...peaks].reverse().map((v, i) => `${n - 1 - i},${mid + v * mid}`).join(' ')
  const peakPath = `M ${peakTop} L ${peakBot} Z`

  const rmsTop = rms.map((v, i) => `${i},${mid - v * mid}`).join(' ')
  const rmsBot = [...rms].reverse().map((v, i) => `${n - 1 - i},${mid + v * mid}`).join(' ')
  const rmsPath = `M ${rmsTop} L ${rmsBot} Z`

  // played portion overlay (left of playhead)
  const playedWidth = position != null ? position * svgW : 0
  const playheadX  = playedWidth

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${svgW} ${svgH}`}
      preserveAspectRatio="none"
      className={`w-full ${onSeek ? 'cursor-pointer' : ''} ${className}`}
      style={{ height, display: 'block' }}
      aria-label="Waveform"
      onClick={handleClick}
    >
      {/* Peak envelope — unplayed, faint violet */}
      <path d={peakPath} fill="#7c3aed" fillOpacity={0.25} />
      {/* RMS energy — unplayed */}
      <path d={rmsPath} fill="#7c3aed" fillOpacity={0.7} />

      {/* Played portion clip */}
      {position != null && playedWidth > 0 && (
        <>
          <clipPath id={`played-${hash}`}>
            <rect x={0} y={0} width={playedWidth} height={svgH} />
          </clipPath>
          {/* Played peak — brighter */}
          <path d={peakPath} fill="#a78bfa" fillOpacity={0.5} clipPath={`url(#played-${hash})`} />
          <path d={rmsPath} fill="#c4b5fd" fillOpacity={0.9} clipPath={`url(#played-${hash})`} />
        </>
      )}

      {/* Centre line */}
      <line x1={0} y1={mid} x2={svgW} y2={mid} stroke="#3f3f46" strokeWidth={0.5} />

      {/* Playhead */}
      {position != null && (
        <line
          x1={playheadX}
          y1={0}
          x2={playheadX}
          y2={svgH}
          stroke="#a78bfa"
          strokeWidth={1.5}
        />
      )}
    </svg>
  )
}
