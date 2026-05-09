import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, Radio, Plus, Trash2, Layers, Play, Square } from 'lucide-react'
import clsx from 'clsx'
import { createZone, deleteZone, stopZone, type AirPlayZone } from '../lib/api'

interface AirPlayEndpoint {
  endpoint_id: string
  name: string
  ip: string
  port: number
  model: string
  protocol: 'airplay2' | 'raop'
  discovered_at: string
}

function useFluxState(): { endpoints: AirPlayEndpoint[]; zones: AirPlayZone[] } {
  const [endpoints, setEndpoints] = useState<AirPlayEndpoint[]>([])
  const [zones, setZones] = useState<AirPlayZone[]>([])
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
          if (Array.isArray(data)) {
            // Endpoints have endpoint_id; zones have zone_id
            if (data.length === 0 || 'endpoint_id' in (data[0] ?? {})) setEndpoints(data)
            else if ('zone_id' in (data[0] ?? {})) setZones(data)
          }
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

  return { endpoints, zones }
}

function EndpointCard({ ep, selected, onToggleSelect }: {
  ep: AirPlayEndpoint
  selected: boolean
  onToggleSelect: () => void
}) {
  const isAirPlay2 = ep.protocol === 'airplay2'
  return (
    <div
      onClick={onToggleSelect}
      className={clsx(
        'bg-zinc-900 border rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition-colors',
        selected ? 'border-violet-500 bg-violet-950/20' : 'border-zinc-800 hover:border-zinc-700',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          isAirPlay2 ? 'bg-violet-900/40' : 'bg-zinc-800',
        )}>
          {isAirPlay2
            ? <Wifi className="h-4 w-4 text-violet-400" />
            : <Radio className="h-4 w-4 text-zinc-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100 truncate">{ep.name}</p>
          <p className="text-xs text-zinc-500">{ep.model}</p>
        </div>
        <span className={clsx(
          'text-[10px] font-mono font-semibold uppercase tracking-wider rounded px-1.5 py-0.5',
          isAirPlay2 ? 'bg-violet-900/30 text-violet-400' : 'bg-zinc-800 text-zinc-500',
        )}>
          {ep.protocol}
        </span>
      </div>
      <div className="text-[10px] text-zinc-700 font-mono">{ep.ip}:{ep.port}</div>
    </div>
  )
}

function ZoneCard({ zone, onDelete }: { zone: AirPlayZone; onDelete: () => void }) {
  const { mutate: stop } = useMutation({ mutationFn: () => stopZone(zone.zone_id) })
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
      <Layers className="w-5 h-5 text-violet-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100">{zone.name}</p>
        <p className="text-xs text-zinc-500">{zone.endpoint_ids.length} endpoint{zone.endpoint_ids.length !== 1 ? 's' : ''}</p>
      </div>
      <button
        onClick={() => stop()}
        title="Stop zone"
        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <Square className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onDelete}
        title="Delete zone"
        className="p-1.5 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function ZoneBuilder({ endpoints }: { endpoints: AirPlayEndpoint[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const qc = useQueryClient()

  const { mutate: create, isPending } = useMutation({
    mutationFn: () => createZone({
      zone_id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      endpoint_ids: [...selected],
    }),
    onSuccess: () => { setShowForm(false); setName(''); setSelected(new Set()) },
  })

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 w-fit px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> Create zone
        </button>
      ) : (
        <div className="bg-zinc-900 border border-violet-800/40 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-zinc-300">New zone</p>
          <input
            className="w-full max-w-xs bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
            placeholder="Zone name (e.g. Whole House)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Select endpoints</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {endpoints.map(ep => (
                <EndpointCard
                  key={ep.endpoint_id}
                  ep={ep}
                  selected={selected.has(ep.endpoint_id)}
                  onToggleSelect={() => toggle(ep.endpoint_id)}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => create()}
              disabled={!name || selected.size === 0 || isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Save zone
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Hardware() {
  const { endpoints, zones } = useFluxState()
  const [selectMode, setSelectMode] = useState(false)

  const { mutate: removeZone } = useMutation({ mutationFn: deleteZone })

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Hardware</h1>
        <p className="text-xs text-zinc-500 mt-1">Live AirPlay endpoints and zone groups. Zones fan a stream to multiple speakers simultaneously.</p>
      </div>

      {/* Endpoints */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 mb-1">AirPlay Endpoints</h2>
        <p className="text-xs text-zinc-600 mb-4">
          Discovered via mDNS · auto-updates as devices appear/disappear
        </p>
        {endpoints.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <WifiOff className="w-8 h-8 text-zinc-700" />
            <p className="text-zinc-500 text-sm">No AirPlay devices found on the network yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {endpoints.map(ep => (
              <EndpointCard key={ep.endpoint_id} ep={ep} selected={false} onToggleSelect={() => {}} />
            ))}
          </div>
        )}
      </div>

      {/* Zones */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 mb-1">Zones</h2>
        <p className="text-xs text-zinc-600 mb-4">
          Group endpoints into zones for multi-room playback
        </p>
        <div className="flex flex-col gap-3">
          {zones.map(z => (
            <ZoneCard key={z.zone_id} zone={z} onDelete={() => removeZone(z.zone_id)} />
          ))}
          {endpoints.length > 0 && <ZoneBuilder endpoints={endpoints} />}
        </div>
        {zones.length === 0 && endpoints.length === 0 && (
          <p className="text-zinc-600 text-xs">Connect AirPlay devices first to create zones.</p>
        )}
      </div>
    </div>
  )
}
