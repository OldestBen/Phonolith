import { useEffect, useRef, useState, useCallback } from 'react'
import type { TaskEvent } from '../components/TaskMonitor'

const MAX = 100

let _id = 0
function nextId() { return String(++_id) }

// Share a single WebSocket across hooks via a simple pub/sub
type Listener = (ev: TaskEvent) => void
const _listeners = new Set<Listener>()
let _ws: WebSocket | null = null

function connect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  _ws = new WebSocket(`${proto}://${window.location.host}/api/playback/ws`)

  _ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      if (data.service && data.level && data.message) {
        const event: TaskEvent = { id: nextId(), ...data }
        _listeners.forEach(fn => fn(event))
      }
    } catch {
      // ignore non-task messages
    }
  }

  _ws.onclose = () => {
    setTimeout(connect, 3000)
  }
  _ws.onerror = () => _ws?.close()
}

export function useTaskEvents() {
  const [events, setEvents] = useState<TaskEvent[]>([])
  const listenerRef = useRef<Listener | null>(null)

  useEffect(() => {
    connect()

    const listener: Listener = (ev) => {
      setEvents(prev => {
        const next = [...prev, ev]
        return next.length > MAX ? next.slice(next.length - MAX) : next
      })
    }
    listenerRef.current = listener
    _listeners.add(listener)

    return () => {
      if (listenerRef.current) _listeners.delete(listenerRef.current)
    }
  }, [])

  const clear = useCallback(() => setEvents([]), [])

  return { events, clear }
}
