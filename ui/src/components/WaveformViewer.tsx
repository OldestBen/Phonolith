import { useQuery } from '@tanstack/react-query'
import { getWaveform } from '../lib/api'

interface Props {
  hash: string
  height?: number
  className?: string
}

export default function WaveformViewer({ hash, height = 64, className = '' }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['waveform', hash],
    queryFn: () => getWaveform(hash),
    retry: false,
    staleTime: Infinity,
  })

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

  // Build SVG path strings for peak envelope and RMS fill
  // peaks: full mirror (top + bottom)
  // rms: inner fill showing loudness

  const peakTop = peaks.map((v, i) => `${i},${mid - v * mid}`).join(' ')
  const peakBot = [...peaks].reverse().map((v, i) => `${n - 1 - i},${mid + v * mid}`).join(' ')
  const peakPath = `M ${peakTop} L ${peakBot} Z`

  const rmsTop = rms.map((v, i) => `${i},${mid - v * mid}`).join(' ')
  const rmsBot = [...rms].reverse().map((v, i) => `${n - 1 - i},${mid + v * mid}`).join(' ')
  const rmsPath = `M ${rmsTop} L ${rmsBot} Z`

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height, display: 'block' }}
      aria-label="Waveform"
    >
      {/* Peak envelope — faint violet */}
      <path d={peakPath} fill="#7c3aed" fillOpacity={0.25} />
      {/* RMS energy — brighter violet */}
      <path d={rmsPath} fill="#7c3aed" fillOpacity={0.7} />
      {/* Centre line */}
      <line x1={0} y1={mid} x2={svgW} y2={mid} stroke="#3f3f46" strokeWidth={0.5} />
    </svg>
  )
}
