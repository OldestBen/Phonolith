'use client'

import { useState } from 'react'

interface WaveformProps {
  hash: string
}

export default function Waveform({ hash }: WaveformProps) {
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="w-full h-24 bg-surface-2 rounded-lg border border-border flex items-center justify-center text-text-muted text-sm">
        Waveform not available
      </div>
    )
  }

  return (
    <div className="w-full rounded-lg overflow-hidden border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/waveforms/${hash}`}
        alt="Audio waveform"
        className="w-full h-24 object-cover"
        onError={() => setError(true)}
      />
    </div>
  )
}
