import { useEffect, useRef, useState } from 'react'

export interface SignalPathState {
  blake3_hash: string
  path: string
  source_format: string
  source_bit_depth: number
  source_sample_rate: number
  source_channels: number
  source_bitrate_kbps: number
  decoder: string
  dsp_active: boolean
  transport: string
  output_endpoint: string
  output_format: string
  is_bit_perfect: boolean
  hash_verified: boolean
  state: 'playing' | 'stopped' | 'error'
  timestamp: string
  // optional playback position emitted by Lucid/Flux on a cadence
  position_seconds?: number
  duration_seconds?: number
}

export function usePlayback() {
  const [signal, setSignal] = useState<SignalPathState | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/api/playback/ws`)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as SignalPathState
          if (data.state) setSignal(data)
        } catch {
          // ignore non-JSON keepalives
        }
      }

      ws.onclose = () => {
        reconnectTimer.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [])

  return signal
}
