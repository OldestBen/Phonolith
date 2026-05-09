import { useEffect, useRef, useState } from 'react'
import { Wifi, WifiOff, Cpu, Radio } from 'lucide-react'
import clsx from 'clsx'

interface AirPlayEndpoint {
  endpoint_id: string
  name: string
  ip: string
  port: number
  model: string
  protocol: 'airplay2' | 'raop'
  discovered_at: string
}

function useFluxEndpoints(): AirPlayEndpoint[] {
  const [endpoints, setEndpoints] = useState<AirPlayEndpoint[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/api/playback/ws`)
      wsRef.current = ws

      ws.onmessage = ev => {
        try {
          const data = JSON.parse(ev.data)
          // Flux publishes endpoint lists to phonolith.flux.endpoints
          // which the API WebSocket fan-out relays — detect by presence of array
          if (Array.isArray(data)) setEndpoints(data)
        } catch { /* ignore */ }
      }
      ws.onclose = () => { reconnect.current = setTimeout(connect, 3000) }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      if (reconnect.current) clearTimeout(reconnect.current)
      wsRef.current?.close()
    }
  }, [])

  return endpoints
}

function EndpointCard({ ep }: { ep: AirPlayEndpoint }) {
  const isAirPlay2 = ep.protocol === 'airplay2'
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className={clsx(
          'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
          isAirPlay2 ? 'bg-violet-900/40' : 'bg-zinc-800',
        )}>
          {isAirPlay2
            ? <Wifi className="h-5 w-5 text-violet-400" />
            : <Radio className="h-5 w-5 text-zinc-400" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{ep.name}</p>
          <p className="text-xs text-zinc-500">{ep.model}</p>
        </div>
        <span className={clsx(
          'ml-auto text-[10px] font-mono font-semibold uppercase tracking-wider rounded px-1.5 py-0.5',
          isAirPlay2 ? 'bg-violet-900/30 text-violet-400' : 'bg-zinc-800 text-zinc-500',
        )}>
          {ep.protocol}
        </span>
      </div>
      <div className="text-xs text-zinc-600 font-mono">{ep.ip}:{ep.port}</div>
    </div>
  )
}

export default function Hardware() {
  const endpoints = useFluxEndpoints()

  return (
    <div className="flex flex-col gap-6">
      {/* AirPlay endpoints */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-1">AirPlay Endpoints</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Discovered via mDNS by Flux — live view, auto-refreshes as devices appear/disappear
        </p>
        {endpoints.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <WifiOff className="w-10 h-10 text-zinc-700" />
            <p className="text-zinc-500 text-sm">No AirPlay devices found on the network yet</p>
            <p className="text-zinc-700 text-xs">Flux scans for _airplay._tcp and _raop._tcp services</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {endpoints.map(ep => <EndpointCard key={ep.endpoint_id} ep={ep} />)}
          </div>
        )}
      </div>

      {/* Cathode placeholder */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-400">Cathode — Endpoint Burn-In</h2>
        </div>
        <p className="text-zinc-600 text-xs">
          Per-endpoint listening hours and hardware-correlated stats will appear here as play events accumulate.
        </p>
      </div>
    </div>
  )
}
