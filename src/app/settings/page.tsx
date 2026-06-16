'use client'

import { useState, useEffect, useCallback } from 'react'
import AddLibrarySource from '@/components/AddLibrarySource'

// ── Helpers ───────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-text-primary text-base font-semibold mb-4 pb-2 border-b border-border">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ApiKeyField({ label, settingKey, testEndpoint }: {
  label: string
  settingKey: string
  testEndpoint?: string
}) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [meta, setMeta] = useState<{ source: 'db' | 'env' | 'unset'; masked: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/settings/keys?key=${settingKey}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMeta({ source: d.source, masked: d.masked }) })
      .catch(() => {})
  }, [settingKey])

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const r = await fetch('/api/settings/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: settingKey, value: value.trim() }),
      })
      if (r.ok) {
        setSaveMsg('Saved — takes effect immediately')
        setValue('')
        setMeta({ source: 'db', masked: '•••••' + value.trim().slice(-4) })
      } else {
        const d = await r.json()
        setSaveMsg(d.error ?? 'Save failed')
      }
    } catch {
      setSaveMsg('Save failed')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 5000)
    }
  }

  const handleClear = async () => {
    await fetch(`/api/settings/keys?key=${settingKey}`, { method: 'DELETE' })
    setMeta(m => m ? { ...m, source: 'unset', masked: '' } : null)
    setSaveMsg('Cleared — using environment variable if set')
    setTimeout(() => setSaveMsg(null), 5000)
  }

  const handleTest = async () => {
    if (!testEndpoint) return
    setTestStatus('testing')
    setTestError(null)
    try {
      const r = await fetch(testEndpoint)
      const ct = r.headers.get('content-type') ?? ''
      const data = ct.includes('json') ? await r.json() : null
      const passed = data !== null ? data.ok === true : r.ok
      setTestStatus(passed ? 'ok' : 'fail')
      if (!passed && data?.error) setTestError(data.error)
    } catch {
      setTestStatus('fail')
      setTestError('Request failed')
    }
    setTimeout(() => { setTestStatus('idle'); setTestError(null) }, 6000)
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-text-muted text-xs uppercase tracking-widest">{label}</label>
        {meta && (
          <div className="flex items-center gap-2">
            {meta.source === 'db' && (
              <>
                <span className="text-accent text-[10px] font-medium">Saved in database</span>
                <button onClick={handleClear} className="text-text-muted text-[10px] hover:text-danger transition-colors">Clear</button>
              </>
            )}
            {meta.source === 'env' && (
              <span className="text-success text-[10px] font-medium">Set via environment</span>
            )}
            {meta.source === 'unset' && (
              <span className="text-warning text-[10px] font-medium">Not configured</span>
            )}
          </div>
        )}
      </div>

      {/* Current value display */}
      {meta && meta.source !== 'unset' && (
        <div className="bg-background border border-border rounded-lg px-3 py-2 mb-2 font-mono text-xs text-text-muted">
          {meta.masked || '(empty)'}
        </div>
      )}

      {/* New value input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={meta?.source === 'unset' ? `Enter ${label}…` : `Enter new ${label} to override…`}
            className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full pr-10 focus:outline-none focus:border-accent transition-colors"
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors text-xs"
          >
            {show ? '🙈' : '👁'}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-40 shrink-0"
        >
          {saving ? '…' : 'Save'}
        </button>
        {testEndpoint && (
          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="px-3 py-2 rounded-lg bg-surface-2 border border-border text-text-primary text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50 shrink-0"
          >
            {testStatus === 'testing' ? '…' : testStatus === 'ok' ? '✓' : testStatus === 'fail' ? '✗' : 'Test'}
          </button>
        )}
      </div>
      {saveMsg && <p className="text-text-muted text-xs mt-1">{saveMsg}</p>}
      {testStatus === 'ok' && <p className="text-success text-xs mt-1">Connection successful</p>}
      {testStatus === 'fail' && (
        <p className="text-danger text-xs mt-1">{testError ?? 'Connection failed'}</p>
      )}
    </div>
  )
}

// ── Library Sources ───────────────────────────────────────────────────────────
interface LibrarySource {
  id: number
  name: string
  type: 'local' | 'smb' | 'nfs' | 'iscsi'
  config: Record<string, string>
  enabled: boolean
  last_scanned_at: string | null
  created_at: string
}

const TYPE_BADGE: Record<string, string> = {
  local: 'bg-surface-2 text-text-muted border-border',
  smb: 'bg-accent/10 text-accent border-accent/20',
  nfs: 'bg-success/10 text-success border-success/20',
  iscsi: 'bg-warning/10 text-warning border-warning/20',
}

function SourceRow({ source, onDeleted, onScanned }: { source: LibrarySource; onDeleted: () => void; onScanned: () => void }) {
  const [testing, setTesting] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleTest = async () => {
    setTesting('testing')
    setTestError(null)
    try {
      const r = await fetch(`/api/library/sources/${source.id}/test`, { method: 'POST' })
      const d = await r.json()
      setTesting(d.ok ? 'ok' : 'fail')
      if (!d.ok && d.error) setTestError(d.error)
    } catch {
      setTesting('fail')
      setTestError('Could not reach analyst sidecar')
    }
    setTimeout(() => { setTesting('idle'); setTestError(null) }, 12000)
  }

  const handleScan = async () => {
    setScanning(true)
    try {
      await fetch(`/api/library/sources/${source.id}/scan`, { method: 'POST' })
      onScanned()
    } catch {}
    setScanning(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete source "${source.name}"?`)) return
    setDeleting(true)
    await fetch(`/api/library/sources/${source.id}`, { method: 'DELETE' })
    onDeleted()
  }

  const sourceDesc = source.type === 'smb'
    ? `smb://${source.config.host ?? ''}/${source.config.share ?? ''}${source.config.subfolder ? '/' + source.config.subfolder : ''}`
    : source.config.path ?? ''

  return (
    <div className="py-3 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-text-primary text-sm font-medium">{source.name}</span>
            <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border ${TYPE_BADGE[source.type] ?? TYPE_BADGE.local}`}>
              {source.type}
            </span>
          </div>
          <p className="text-text-muted text-xs font-mono truncate">{sourceDesc}</p>
          {source.last_scanned_at && (
            <p className="text-text-muted text-[10px] mt-0.5">
              Last scanned {new Date(source.last_scanned_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleTest}
            disabled={testing === 'testing'}
            className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
              testing === 'ok'
                ? 'bg-success/10 border-success/20 text-success'
                : testing === 'fail'
                ? 'bg-danger/10 border-danger/20 text-danger'
                : 'bg-surface-2 border-border text-text-muted hover:text-text-primary hover:border-accent/30'
            }`}
          >
            {testing === 'testing' ? '…' : testing === 'ok' ? '✓ OK' : testing === 'fail' ? '✗ Fail' : 'Test'}
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-2.5 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-2.5 py-1.5 rounded-lg border border-border text-danger/60 text-xs hover:text-danger hover:border-danger/30 transition-colors disabled:opacity-50"
          >
            ×
          </button>
        </div>
      </div>
      {testError && (
        <p className="text-danger text-xs mt-1.5 font-mono break-all">{testError}</p>
      )}
    </div>
  )
}

function LibrarySourcesSection() {
  const [sources, setSources] = useState<LibrarySource[]>([])
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(() => {
    fetch('/api/library/sources')
      .then(r => r.ok ? r.json() : [])
      .then(setSources)
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      {sources.length > 0 ? (
        <div className="mb-4">
          {sources.map(s => (
            <SourceRow key={s.id} source={s} onDeleted={load} onScanned={load} />
          ))}
        </div>
      ) : (
        <div className="bg-surface-2 rounded-xl border border-border/50 p-6 text-center mb-4">
          <p className="text-text-muted text-sm">No library sources configured.</p>
          <p className="text-text-muted text-xs mt-1">Add a local path, SMB share, NFS, or iSCSI target.</p>
        </div>
      )}
      <button
        onClick={() => setShowAdd(true)}
        className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
      >
        + Add Source
      </button>
      {showAdd && <AddLibrarySource onClose={() => setShowAdd(false)} onSaved={load} />}
    </div>
  )
}

// ── Playback ──────────────────────────────────────────────────────────────────
interface AlsaDevice {
  id: string
  name: string
  description?: string
}

function PlaybackSection() {
  const [devices, setDevices] = useState<AlsaDevice[]>([])
  const [lucidOnline, setLucidOnline] = useState<boolean | null>(null)
  const [device, setDevice] = useState('')
  const [endpointName, setEndpointName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    // Load current saved values
    Promise.all([
      fetch('/api/settings/keys?key=LUCID_DEVICE').then(r => r.ok ? r.json() : null),
      fetch('/api/settings/keys?key=LUCID_ENDPOINT_NAME').then(r => r.ok ? r.json() : null),
    ]).then(([devMeta, nameMeta]) => {
      // meta.masked is just the masked display — to get the real value we rely on Lucid status
    }).catch(() => {})

    // Fetch ALSA devices from Lucid sidecar
    fetch('/api/lucid/devices')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.online !== false) {
          setLucidOnline(true)
          const devList: AlsaDevice[] = Array.isArray(data) ? data : (data.devices ?? [])
          setDevices(devList)
        } else if (data?.online === false) {
          setLucidOnline(false)
        }
      })
      .catch(() => setLucidOnline(false))

    // Also get current status to see selected device
    fetch('/api/lucid/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.online !== false) {
          setLucidOnline(true)
          if (data?.device) setDevice(data.device)
          if (data?.endpoint_name) setEndpointName(data.endpoint_name)
        }
      })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const saves: Promise<Response>[] = []
      if (device) {
        saves.push(fetch('/api/settings/keys', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'LUCID_DEVICE', value: device }),
        }))
      }
      if (endpointName.trim()) {
        saves.push(fetch('/api/settings/keys', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'LUCID_ENDPOINT_NAME', value: endpointName.trim() }),
        }))
      }
      await Promise.all(saves)
      setSaveMsg('Saved — restart Lucid for device changes to take effect')
    } catch {
      setSaveMsg('Save failed')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 8000)
    }
  }

  return (
    <div className="space-y-5">
      {/* Lucid status */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          lucidOnline === null ? 'bg-text-muted animate-pulse' :
          lucidOnline ? 'bg-success' : 'bg-danger'
        }`} />
        <span className="text-text-muted text-xs">
          {lucidOnline === null ? 'Checking Lucid sidecar…' :
           lucidOnline ? 'Lucid sidecar online — bit-perfect ALSA playback available' :
           'Lucid sidecar offline — start it with docker compose up -d lucid'}
        </span>
      </div>

      {/* ALSA output device */}
      <div>
        <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">
          ALSA Output Device
        </label>
        {devices.length > 0 ? (
          <select
            value={device}
            onChange={e => setDevice(e.target.value)}
            className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full
                       focus:outline-none focus:border-accent transition-colors"
          >
            <option value="">Select device…</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}{d.description ? ` — ${d.description}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={device}
            onChange={e => setDevice(e.target.value)}
            placeholder="e.g. hw:0,0 or default"
            className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full
                       focus:outline-none focus:border-accent transition-colors font-mono"
          />
        )}
        <p className="text-text-muted text-xs mt-1">
          {lucidOnline ? 'Exclusive ALSA access — bypasses the kernel mixer for bit-perfect output.' :
           'Enter an ALSA device string (hw:0,0, plughw:1,0, etc.).'}
        </p>
      </div>

      {/* Endpoint name */}
      <div>
        <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">
          Endpoint Display Name
        </label>
        <input
          type="text"
          value={endpointName}
          onChange={e => setEndpointName(e.target.value)}
          placeholder="e.g. Chord Hugo TT2, iFi Zen DAC, Built-in Speakers"
          className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full
                     focus:outline-none focus:border-accent transition-colors"
        />
        <p className="text-text-muted text-xs mt-1">
          Shown in the Signal Path display and playback bar.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Playback Settings'}
        </button>
        {saveMsg && <span className="text-text-muted text-sm">{saveMsg}</span>}
      </div>
    </div>
  )
}

// ── Backup ────────────────────────────────────────────────────────────────────
interface LastBackup {
  timestamp: string
  s3_key: string
  size_bytes: number
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exp)
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`
}

function BackupSection() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [lastBackup, setLastBackup] = useState<LastBackup | null>(null)
  const [backing, setBacking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [statusOk, setStatusOk] = useState(true)

  const load = useCallback(() => {
    fetch('/api/backup')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setConfigured(!!data.configured)
        setLastBackup(data.last_backup ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const handleBackup = async () => {
    setBacking(true)
    setStatus(null)
    try {
      const r = await fetch('/api/backup', { method: 'POST' })
      const data = await r.json()
      if (r.ok) {
        setStatusOk(true)
        setStatus(`Backup complete — ${formatBytes(data.size_bytes)}`)
        load()
      } else {
        setStatusOk(false)
        setStatus(data.error ?? 'Backup failed.')
      }
    } catch {
      setStatusOk(false)
      setStatus('Backup failed — check your S3 configuration.')
    } finally {
      setBacking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          configured === null ? 'bg-text-muted animate-pulse' :
          configured ? 'bg-success' : 'bg-danger'
        }`} />
        <span className="text-text-muted text-xs">
          {configured === null ? 'Checking S3 configuration…' :
           configured ? 'S3 configured' :
           'S3 not configured — set S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY'}
        </span>
      </div>

      {lastBackup ? (
        <div className="bg-surface-2 rounded-xl border border-border/50 p-4">
          <p className="text-text-primary text-sm font-medium">
            Last backup: {new Date(lastBackup.timestamp).toLocaleString()}
          </p>
          <p className="text-text-muted text-xs mt-1">
            {formatBytes(lastBackup.size_bytes)} — {lastBackup.s3_key}
          </p>
        </div>
      ) : (
        <div className="bg-surface-2 rounded-xl border border-border/50 p-4">
          <p className="text-text-muted text-sm">No backups yet.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleBackup} disabled={backing || !configured} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50">
          {backing ? 'Backing up…' : 'Backup Now'}
        </button>
        {status && <span className={`text-sm ${statusOk ? 'text-text-muted' : 'text-danger'}`}>{status}</span>}
      </div>
    </div>
  )
}

// ── Metadata write-back ───────────────────────────────────────────────────────
function MetadataSection() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/keys?key=id3_writeback_enabled')
      .then(r => r.ok ? r.json() : null)
      .then(d => setEnabled(d?.source === 'db' && d?.masked?.endsWith('true')))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleToggle = async () => {
    const next = !enabled
    setSaving(true)
    try {
      await fetch('/api/settings/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'id3_writeback_enabled', value: next ? 'true' : 'false' }),
      })
      setEnabled(next)
    } catch {} finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-text-primary text-sm font-medium">Write metadata edits back to files</p>
        <p className="text-text-muted text-xs mt-1 max-w-md">
          When you edit a file&apos;s title/artist/album/year/track/disc number, also rewrite the
          embedded tags on disk (via the analyst sidecar) instead of only storing the override in
          the database. Only applies to locally mounted files — never to SMB/NFS shares.
        </p>
      </div>
      <button
        onClick={handleToggle}
        disabled={loading || saving}
        role="switch"
        aria-checked={enabled}
        className={`shrink-0 mt-0.5 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50 ${
          enabled ? 'bg-accent' : 'bg-surface-2 border border-border'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  )
}

interface PeerRow {
  id: string
  name: string
  host: string
  trust_status: 'trusted' | 'blocked'
  share_library: boolean
  share_presence: boolean
  share_backup: boolean
  paired_at: string
  last_seen_at: string | null
}

interface DiscoveredPeer {
  peerId: string
  name: string
  host: string
  port: string
}

function PolyphonySection() {
  const [identity, setIdentity] = useState<{ peerId: string; name: string } | null>(null)
  const [discoveryEnabled, setDiscoveryEnabled] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredPeer[]>([])
  const [peers, setPeers] = useState<PeerRow[]>([])
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [connectHost, setConnectHost] = useState('')
  const [connectCode, setConnectCode] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [mirroring, setMirroring] = useState<string | null>(null)

  const loadPeers = useCallback(() => {
    fetch('/api/polyphony/peers').then(r => r.json()).then(d => setPeers(d.peers ?? [])).catch(() => {})
  }, [])

  const loadDiscovery = useCallback(() => {
    fetch('/api/polyphony/discovery').then(r => r.json()).then(d => {
      setDiscoveryEnabled(!!d.enabled)
      setDiscovered(d.discovered ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/polyphony/identity').then(r => r.json()).then(d => setIdentity({ peerId: d.peerId, name: d.name })).catch(() => {})
    loadPeers()
    loadDiscovery()
  }, [loadPeers, loadDiscovery])

  const toggleDiscovery = async () => {
    const next = !discoveryEnabled
    setDiscoveryEnabled(next)
    await fetch('/api/polyphony/discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {})
  }

  const generateCode = async () => {
    const r = await fetch('/api/polyphony/pairing-code', { method: 'POST' })
    const d = await r.json()
    setPairingCode(d.code)
  }

  const connect = async (host: string, code: string) => {
    setConnecting(true)
    setStatusMsg(null)
    try {
      const r = await fetch('/api/polyphony/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, code }),
      })
      const d = await r.json()
      if (!r.ok) {
        setStatusMsg(d.error ?? 'Pairing failed.')
      } else {
        setStatusMsg(`Paired with ${d.name}.`)
        setConnectHost('')
        setConnectCode('')
        loadPeers()
      }
    } finally {
      setConnecting(false)
    }
  }

  const updatePeer = async (id: string, patch: Partial<PeerRow>) => {
    await fetch(`/api/polyphony/peers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    loadPeers()
  }

  const unpair = async (id: string) => {
    if (!confirm('Unpair this Phonolith instance? They will no longer be able to browse your library or presence.')) return
    await fetch(`/api/polyphony/peers/${id}`, { method: 'DELETE' })
    loadPeers()
  }

  const mirrorBackup = async (id: string, name: string) => {
    setMirroring(id)
    try {
      const r = await fetch(`/api/polyphony/backup/mirror/${id}`, { method: 'POST' })
      const d = await r.json()
      setStatusMsg(r.ok ? `Backup mirrored to ${name}.` : (d.error ?? 'Mirroring failed.'))
    } finally {
      setMirroring(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {identity && (
        <div className="text-xs text-text-muted">
          This instance: <span className="text-text-primary font-medium">{identity.name}</span>{' '}
          <span className="font-mono">({identity.peerId.slice(0, 8)})</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-text-primary text-sm font-medium">LAN discovery</p>
          <p className="text-text-muted text-xs mt-1 max-w-md">
            Broadcast this instance&apos;s name on the local network so other Phonolith instances can
            find it without typing a hostname. Only your name and ID are broadcast — never your
            library, presence, or backups. Pairing still requires a one-time code.
          </p>
        </div>
        <button
          onClick={toggleDiscovery}
          role="switch"
          aria-checked={discoveryEnabled}
          className={`shrink-0 mt-0.5 w-11 h-6 rounded-full relative transition-colors ${
            discoveryEnabled ? 'bg-accent' : 'bg-surface-2 border border-border'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${discoveryEnabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {discovered.length > 0 && (
        <div>
          <p className="text-text-muted text-xs mb-2">Discovered on this network:</p>
          <div className="flex flex-col gap-1.5">
            {discovered.map(d => (
              <div key={d.peerId} className="flex items-center justify-between bg-surface-2 border border-border rounded-lg px-3 py-2">
                <span className="text-text-primary text-sm">{d.name}</span>
                <button
                  onClick={() => setConnectHost(`http://${d.host}:${d.port}`)}
                  className="text-accent text-xs font-medium hover:underline"
                >
                  Use host →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <p className="text-text-primary text-sm font-medium mb-2">Pair a new instance</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <p className="text-text-muted text-xs mb-1">Generate a code for someone to pair to you</p>
            <button onClick={generateCode} className="px-3 py-1.5 bg-surface border border-border rounded-lg text-text-primary text-xs font-medium hover:border-accent/40 transition-colors">
              Generate pairing code
            </button>
            {pairingCode && (
              <p className="text-accent text-lg font-mono font-bold mt-2 tracking-wider">{pairingCode}</p>
            )}
          </div>
        </div>

        <div className="border-t border-border mt-4 pt-4">
          <p className="text-text-muted text-xs mb-2">Or pair to a code from another instance</p>
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              value={connectHost}
              onChange={e => setConnectHost(e.target.value)}
              placeholder="https://their-host"
              className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
            />
            <input
              value={connectCode}
              onChange={e => setConnectCode(e.target.value)}
              placeholder="Pairing code"
              className="md:w-40 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono"
            />
            <button
              onClick={() => connect(connectHost, connectCode)}
              disabled={connecting || !connectHost || !connectCode}
              className="px-3 py-1.5 bg-accent text-background rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {connecting ? 'Pairing…' : 'Pair'}
            </button>
          </div>
          {statusMsg && <p className="text-text-muted text-xs mt-2">{statusMsg}</p>}
        </div>
      </div>

      <div>
        <p className="text-text-primary text-sm font-medium mb-2">Paired instances ({peers.length})</p>
        {peers.length === 0 && <p className="text-text-muted text-xs">No paired instances yet.</p>}
        <div className="flex flex-col gap-2">
          {peers.map(p => (
            <div key={p.id} className="bg-surface-2 border border-border rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{p.name}</p>
                  <p className="text-text-muted text-xs truncate">{p.host}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => mirrorBackup(p.id, p.name)}
                    disabled={mirroring === p.id}
                    className="px-2 py-1 bg-surface border border-border rounded text-xs text-text-muted hover:text-accent disabled:opacity-50"
                  >
                    {mirroring === p.id ? 'Mirroring…' : 'Mirror backup'}
                  </button>
                  <button onClick={() => unpair(p.id)} className="px-2 py-1 bg-surface border border-border rounded text-xs text-danger hover:border-danger/40">
                    Unpair
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                <PeerToggle label="Library" value={p.share_library} onChange={v => updatePeer(p.id, { share_library: v })} />
                <PeerToggle label="Presence" value={p.share_presence} onChange={v => updatePeer(p.id, { share_presence: v })} />
                <PeerToggle label="Accept backups" value={p.share_backup} onChange={v => updatePeer(p.id, { share_backup: v })} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PeerToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
        value ? 'bg-accent/10 border-accent/40 text-accent' : 'bg-surface border-border text-text-muted'
      }`}
    >
      {label}: {value ? 'on' : 'off'}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-8">Settings</h1>

      <Section title="API Keys">
        <ApiKeyField label="Genius Access Token" settingKey="GENIUS_ACCESS_TOKEN" testEndpoint="/api/settings/genius" />
        <ApiKeyField label="Discogs User Token" settingKey="DISCOGS_USER_TOKEN" />
        <ApiKeyField label="AcoustID API Key" settingKey="ACOUSTID_API_KEY" />
      </Section>

      <Section title="Playback">
        <PlaybackSection />
      </Section>

      <Section title="Library Sources">
        <LibrarySourcesSection />
      </Section>

      <Section title="Backup">
        <BackupSection />
      </Section>

      <Section title="Remote Access">
        <p className="text-text-muted text-xs mb-5 max-w-md">
          Reach this instance remotely without manually forwarding ports. Both options
          run as separate sidecar containers — saving a token here only stores it;
          re-run <code className="font-mono">docker compose up -d</code> (or target the
          specific service, e.g. <code className="font-mono">docker compose up -d tailscale</code>)
          for the sidecar to pick up the new credential. The Next.js app cannot restart
          sibling containers itself.
        </p>
        <p className="text-text-muted text-xs mb-1.5 max-w-md">
          Tailscale joins this instance to your private tailnet — zero-config private
          remote access, no port forwarding. Generate a key from the Tailscale admin
          console (Settings → Keys).
        </p>
        <ApiKeyField label="Tailscale Auth Key" settingKey="TAILSCALE_AUTHKEY" />
        <p className="text-text-muted text-xs mb-1.5 max-w-md">
          Cloudflare Tunnel exposes this instance through Cloudflare&apos;s edge — good
          for sharing with others without exposing your home IP. Create a tunnel and
          copy its token from the Cloudflare Zero Trust dashboard (Networks → Tunnels).
        </p>
        <p className="text-amber-500/90 text-xs mb-1.5 max-w-md">
          ⚠ Cloudflare&apos;s free/Pro tiers are meant for web traffic, not sustained
          high-bitrate audio streaming — routing lossless playback through an Argo
          tunnel for hours at a time risks tripping their ToS and getting the tunnel
          throttled or the domain flagged. Prefer Tailscale above for day-to-day
          listening; reach for Cloudflare Tunnel for occasional sharing, not as your
          primary streaming path.
        </p>
        <ApiKeyField label="Cloudflare Tunnel Token" settingKey="CLOUDFLARE_TUNNEL_TOKEN" />
      </Section>

      <Section title="Metadata">
        <MetadataSection />
      </Section>

      <Section title="Polyphony">
        <PolyphonySection />
      </Section>

      <Section title="Appearance">
        <div className="bg-surface-2 rounded-xl border border-border p-6 text-center">
          <p className="text-text-muted text-sm">Theme variants coming soon.</p>
        </div>
      </Section>
    </div>
  )
}
