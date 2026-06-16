'use client'

import { useEffect, useState } from 'react'
import { useSelectedEndpoint, endpointLabel, type Endpoint } from '@/lib/endpoint'

interface LucidDevices {
  alsa: string[]
  airplay: string[]
}

export default function EndpointPickerModal({ onClose }: { onClose: () => void }) {
  const [endpoint, setEndpoint] = useSelectedEndpoint()
  const [devices, setDevices] = useState<LucidDevices | null>(null)
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/lucid/devices', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then(data => {
        if (data.error || data.online === false) {
          setOnline(false)
        } else {
          setOnline(true)
          setDevices({ alsa: data.alsa ?? [], airplay: data.airplay ?? [] })
        }
      })
      .catch(() => setOnline(false))
      .finally(() => setLoading(false))
  }, [])

  const isSelected = (candidate: Endpoint) =>
    candidate.type === endpoint.type &&
    (candidate.type !== 'alsa' || candidate.device === (endpoint as { device: string }).device) &&
    (candidate.type !== 'airplay' || candidate.name === (endpoint as { name: string }).name)

  const choose = (e: Endpoint) => {
    setEndpoint(e)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-text-primary text-base font-bold">Choose Output Endpoint</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-text-muted hover:text-accent transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <EndpointRow
            label={endpointLabel({ type: 'browser' })}
            sub="Decodes locally via the Web Audio API — no hardware required"
            selected={isSelected({ type: 'browser' })}
            onClick={() => choose({ type: 'browser' })}
          />

          {loading && (
            <p className="text-text-muted text-xs px-3 py-2">Looking for Lucid devices…</p>
          )}

          {!loading && !online && (
            <p className="text-text-muted text-xs px-3 py-2">
              Lucid is offline — only browser playback is available.
            </p>
          )}

          {!loading && online && devices && (
            <>
              {devices.alsa.map(device => (
                <EndpointRow
                  key={`alsa:${device}`}
                  label={endpointLabel({ type: 'alsa', device })}
                  sub="ALSA exclusive output — bit-perfect on supported hardware"
                  selected={isSelected({ type: 'alsa', device })}
                  onClick={() => choose({ type: 'alsa', device })}
                />
              ))}
              {devices.airplay.map(name => (
                <EndpointRow
                  key={`airplay:${name}`}
                  label={endpointLabel({ type: 'airplay', name })}
                  sub="Streamed over AirPlay (RAOP)"
                  selected={isSelected({ type: 'airplay', name })}
                  onClick={() => choose({ type: 'airplay', name })}
                />
              ))}
              {devices.airplay.length === 0 && (
                <p className="text-text-muted text-xs px-3 py-2">No AirPlay endpoints discovered.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function EndpointRow({ label, sub, selected, onClick }: {
  label: string
  sub: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
        selected
          ? 'bg-accent/10 border-accent/40'
          : 'bg-background border-border hover:border-accent/30'
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium truncate ${selected ? 'text-accent' : 'text-text-primary'}`}>{label}</p>
        <p className="text-text-muted text-xs truncate">{sub}</p>
      </div>
      {selected && <span className="text-accent text-sm shrink-0">●</span>}
    </button>
  )
}
