'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { ScreenDesc, CardGrid, FieldsPanel, NoteBox, C, type CardSpec } from '@/components/panel'

// ── Panel chrome ──────────────────────────────────────────────────────────────
// Mirrors FieldsPanel's outer shell (title + dark bevelled box) exactly, for
// sections whose content doesn't fit FieldsPanel's rigid "static value boxes +
// one action" shape (e.g. API key fields, each with their own independent
// save/clear/test controls) — kept visually identical so the whole page reads
// as one system even where the interaction model has to be hand-built.
function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-border bg-[#101012] px-[15px] py-[13px]">
      <p className="m-0 mb-2.5 text-[9px] uppercase tracking-[.2em] text-text-ghost">{title}</p>
      {children}
    </div>
  )
}

function ToggleSwitch({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`shrink-0 mt-0.5 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50 ${
        on ? 'bg-accent-dim' : 'bg-surface-2 border border-border'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
          on ? 'translate-x-5' : ''
        }`}
      />
    </button>
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
    <div className="flex flex-col gap-1.5 pb-4">
      <div className="flex items-center justify-between">
        <label className="text-[9px] uppercase tracking-[.16em] text-text-ghost">{label}</label>
        {meta && (
          <div className="flex items-center gap-2">
            {meta.source === 'db' && (
              <>
                <span className="text-accent text-[9.5px] font-medium">db</span>
                <button onClick={handleClear} className="text-text-ghost text-[9.5px] hover:text-danger transition-colors">clear</button>
              </>
            )}
            {meta.source === 'env' && (
              <span className="text-success text-[9.5px] font-medium">env</span>
            )}
            {meta.source === 'unset' && (
              <span className="text-warning text-[9.5px] font-medium">unset</span>
            )}
          </div>
        )}
      </div>

      {/* Current value display — same box treatment as FieldsPanel's mono value cells */}
      {meta && meta.source !== 'unset' && (
        <div className="rounded-md border border-[#3f3f46] bg-[#0a0a0c] px-[9px] py-1.5 text-[11px] text-amber shadow-[inset_0_0_10px_rgba(0,0,0,.7)]">
          {meta.masked || '(empty)'}
        </div>
      )}

      {/* New value input */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={meta?.source === 'unset' ? `Enter ${label}…` : `Enter new ${label}…`}
            className="rounded-md border border-[#3f3f46] bg-[#0a0a0c] text-text-secondary text-[11px] px-[9px] py-1.5 w-full pr-8 shadow-[inset_0_0_10px_rgba(0,0,0,.7)] focus:outline-none focus:border-accent transition-colors"
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-ghost hover:text-text-secondary transition-colors text-[10px]"
          >
            {show ? '🙈' : '👁'}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="rounded-md px-[13px] py-1.5 text-[10.5px] font-medium text-white shadow-[0_0_15px_rgba(109,40,217,.45)] transition-colors disabled:opacity-40 shrink-0"
          style={{ background: '#6d28d9' }}
        >
          {saving ? '…' : 'Save'}
        </button>
        {testEndpoint && (
          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="rounded-md border border-[#3f3f46] bg-surface px-2.5 py-1.5 text-[10px] text-text-secondary transition-colors disabled:opacity-50 shrink-0"
          >
            {testStatus === 'testing' ? '…' : testStatus === 'ok' ? '✓' : testStatus === 'fail' ? '✗' : 'Test'}
          </button>
        )}
      </div>
      {saveMsg && <p className="text-text-ghost text-[10px]">{saveMsg}</p>}
      {testStatus === 'ok' && <p className="text-success text-[10px]">Connection successful</p>}
      {testStatus === 'fail' && (
        <p className="text-danger text-[10px]">{testError ?? 'Connection failed'}</p>
      )}
    </div>
  )
}

// ── Library Sources ───────────────────────────────────────────────────────────
// Moved to its own screen at /sources — see src/components/LibrarySourcesPanel.tsx
// and src/app/sources/page.tsx.

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

  const selectStyle = 'w-full bg-transparent text-text-secondary text-[11px] focus:outline-none'

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${
          lucidOnline === null ? 'bg-text-ghost animate-pulse' :
          lucidOnline ? 'bg-success' : 'bg-danger'
        }`} style={lucidOnline ? { boxShadow: `0 0 7px ${C.green}` } : undefined} />
        <span className="text-text-faint text-[10.5px]">
          {lucidOnline === null ? 'Checking Lucid sidecar…' :
           lucidOnline ? 'Lucid sidecar online — bit-perfect ALSA playback available' :
           'Lucid sidecar offline — start it with docker compose up -d lucid'}
        </span>
      </div>

      <FieldsPanel
        title="Output routing"
        fields={[
          {
            label: 'ALSA Output Device',
            value: devices.length > 0 ? (
              <select value={device} onChange={e => setDevice(e.target.value)} className={selectStyle}>
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
                className={`${selectStyle} font-mono`}
              />
            ),
          },
          {
            label: 'Endpoint Display Name',
            value: (
              <input
                type="text"
                value={endpointName}
                onChange={e => setEndpointName(e.target.value)}
                placeholder="e.g. Chord Hugo TT2"
                className={selectStyle}
              />
            ),
          },
        ]}
        action={saving ? 'Saving…' : 'Save Playback Settings'}
        onAction={handleSave}
      />
      <p className="text-text-ghost text-[10px]">
        {lucidOnline ? 'Exclusive ALSA access — bypasses the kernel mixer for bit-perfect output.' :
         'Enter an ALSA device string (hw:0,0, plughw:1,0, etc.).'}
        {' '}Endpoint name is shown in the Signal Path display and playback bar.
      </p>
      {saveMsg && <p className="text-text-faint text-[10.5px]">{saveMsg}</p>}
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
  const [bucket, setBucket] = useState<string | null>(null)
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
        setBucket(data.bucket ?? null)
        setLastBackup(data.last_backup ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const handleBackup = async () => {
    if (backing || !configured) return
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

  const badgeColor = configured === null ? C.mut : configured ? C.green : C.yel
  const card: CardSpec = {
    title: bucket ? `s3://${bucket}` : 'S3 backup',
    sub: configured === null ? 'Checking S3 configuration…' : configured ? 'S3 configured' : 'Fill in the fields above to enable backups',
    badge: configured === null ? 'checking…' : configured ? '✓ configured' : '⚠ not configured',
    badgeColor,
    dot: badgeColor,
    rows: lastBackup
      ? [
          ['Last backup', new Date(lastBackup.timestamp).toLocaleString(), C.txt],
          ['Size', formatBytes(lastBackup.size_bytes), C.txt],
          ['Object key', lastBackup.s3_key, C.dim],
        ]
      : [['Last backup', 'never', C.dim]],
    actions: [[backing ? 'Backing up…' : 'Back up now', true]],
    foot: statusOk ? (status ?? undefined) : undefined,
    onAction: handleBackup,
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-6 sm:grid-cols-2">
        <ApiKeyField label="S3 Bucket" settingKey="S3_BUCKET" />
        <ApiKeyField label="S3 Region" settingKey="S3_REGION" />
        <ApiKeyField label="AWS Access Key ID" settingKey="AWS_ACCESS_KEY_ID" />
        <ApiKeyField label="AWS Secret Access Key" settingKey="AWS_SECRET_ACCESS_KEY" />
      </div>
      <CardGrid columns={false} cards={[card]} />
      {status && !statusOk && <p className="text-danger text-[10.5px]">{status}</p>}
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
        <p className="text-text-secondary text-[11.5px] font-medium">Write metadata edits back to files</p>
        <p className="text-text-faint text-[10.5px] mt-1 max-w-md leading-[1.6]">
          When you edit a file&apos;s title/artist/album/year/track/disc number, also rewrite the
          embedded tags on disk (via the analyst sidecar) instead of only storing the override in
          the database. Only applies to locally mounted files — never to SMB/NFS shares.
        </p>
      </div>
      <ToggleSwitch on={enabled} onToggle={handleToggle} disabled={loading || saving} />
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
    fetch('/api/polyphony/peers').then(r => r.ok ? r.json() : null).then(d => { if (d) setPeers(d.peers ?? []) }).catch(() => {})
  }, [])

  const loadDiscovery = useCallback(() => {
    fetch('/api/polyphony/discovery').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setDiscoveryEnabled(!!d.enabled); setDiscovered(d.discovered ?? []) }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/polyphony/identity').then(r => r.ok ? r.json() : null).then(d => { if (d?.peerId) setIdentity({ peerId: d.peerId, name: d.name }) }).catch(() => {})
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
    <div className="flex flex-col gap-4">
      {identity && (
        <div className="text-[10px] text-text-ghost">
          This instance: <span className="text-text-secondary font-medium">{identity.name}</span>{' '}
          <span className="font-mono">({identity.peerId.slice(0, 8)})</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-text-secondary text-[11.5px] font-medium">LAN discovery</p>
          <p className="text-text-faint text-[10.5px] mt-1 max-w-md leading-[1.6]">
            Broadcast this instance&apos;s name on the local network so other Phonolith instances can
            find it without typing a hostname. Only your name and ID are broadcast — never your
            library, presence, or backups. Pairing still requires a one-time code.
          </p>
        </div>
        <ToggleSwitch on={discoveryEnabled} onToggle={toggleDiscovery} />
      </div>

      {discovered.length > 0 && (
        <div>
          <p className="text-text-ghost text-[10px] mb-1.5 uppercase tracking-[.16em]">Discovered on this network</p>
          <div className="flex flex-col gap-1.5">
            {discovered.map(d => (
              <div key={d.peerId} className="flex items-center justify-between rounded-md border border-[#3f3f46] bg-[#0a0a0c] px-3 py-2">
                <span className="text-text-secondary text-[11px]">{d.name}</span>
                <button
                  onClick={() => setConnectHost(`http://${d.host}:${d.port}`)}
                  className="text-accent text-[10px] font-medium hover:underline"
                >
                  Use host →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-[10px] border border-border bg-[#0a0a0c] p-4">
        <p className="text-text-secondary text-[11px] font-medium mb-2">Pair a new instance</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <p className="text-text-ghost text-[10px] mb-1">Generate a code for someone to pair to you</p>
            <button
              onClick={generateCode}
              className="rounded-md border border-[#3f3f46] bg-surface px-2.5 py-1.5 text-[10px] text-text-secondary hover:border-accent/40 transition-colors"
            >
              Generate pairing code
            </button>
            {pairingCode && (
              <p className="text-amber text-lg font-mono font-bold mt-2 tracking-wider">{pairingCode}</p>
            )}
          </div>
        </div>

        <div className="border-t border-border mt-4 pt-4">
          <p className="text-text-ghost text-[10px] mb-1.5">Or pair to a code from another instance</p>
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              value={connectHost}
              onChange={e => setConnectHost(e.target.value)}
              placeholder="https://their-host"
              className="flex-1 rounded-md border border-[#3f3f46] bg-[#0a0a0c] px-3 py-1.5 text-[11px] text-text-secondary shadow-[inset_0_0_10px_rgba(0,0,0,.7)] focus:outline-none focus:border-accent"
            />
            <input
              value={connectCode}
              onChange={e => setConnectCode(e.target.value)}
              placeholder="Pairing code"
              className="md:w-40 rounded-md border border-[#3f3f46] bg-[#0a0a0c] px-3 py-1.5 text-[11px] text-text-secondary font-mono shadow-[inset_0_0_10px_rgba(0,0,0,.7)] focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => connect(connectHost, connectCode)}
              disabled={connecting || !connectHost || !connectCode}
              className="rounded-md px-3 py-1.5 text-[10.5px] font-semibold text-white shadow-[0_0_15px_rgba(109,40,217,.45)] disabled:opacity-40 transition-colors"
              style={{ background: '#6d28d9' }}
            >
              {connecting ? 'Pairing…' : 'Pair'}
            </button>
          </div>
          {statusMsg && <p className="text-text-ghost text-[10px] mt-2">{statusMsg}</p>}
        </div>
      </div>

      <div>
        <p className="text-text-secondary text-[11px] font-medium mb-2">Paired instances ({peers.length})</p>
        {peers.length === 0 && <p className="text-text-ghost text-[10px]">No paired instances yet.</p>}
        <div className="flex flex-col gap-2">
          {peers.map(p => {
            const dot = p.trust_status === 'trusted' ? C.green : C.red
            return (
              <div
                key={p.id}
                className="rounded-[9px] border px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,.06),inset_0_-14px_24px_rgba(0,0,0,.35)]"
                style={{ borderColor: '#27272a', background: 'linear-gradient(180deg,#15151a,#0d0d10)' }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-xs font-semibold text-text-primary">{p.name}</p>
                    <p className="mt-0.5 text-[10px] text-text-faint truncate">{p.host}</p>
                  </div>
                  <span className="shrink-0 text-[9.5px]" style={{ color: dot }}>{p.trust_status}</span>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <PeerToggle label="Library" value={p.share_library} onChange={v => updatePeer(p.id, { share_library: v })} />
                  <PeerToggle label="Presence" value={p.share_presence} onChange={v => updatePeer(p.id, { share_presence: v })} />
                  <PeerToggle label="Accept backups" value={p.share_backup} onChange={v => updatePeer(p.id, { share_backup: v })} />
                </div>

                <div className="mt-[11px] flex gap-1.5">
                  <button
                    onClick={() => mirrorBackup(p.id, p.name)}
                    disabled={mirroring === p.id}
                    className="rounded-md border border-[#3f3f46] bg-surface px-2.5 py-1 text-[10px] text-text-secondary disabled:opacity-50"
                  >
                    {mirroring === p.id ? 'Mirroring…' : 'Mirror backup'}
                  </button>
                  <button
                    onClick={() => unpair(p.id)}
                    className="rounded-md border border-[#3f3f46] bg-surface px-2.5 py-1 text-[10px] text-danger"
                  >
                    Unpair
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PeerToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`text-[9.5px] px-1.5 py-0.5 rounded border transition-colors ${
        value ? 'bg-accent/10 border-accent/40 text-accent' : 'bg-surface border-border text-text-muted'
      }`}
    >
      {label}: {value ? 'on' : 'off'}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  usePageHeader('Settings', 'system configuration and health')

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[13px] px-6 py-6">
      <ScreenDesc>
        API credentials, playback output, backups, remote access, and library sharing all live here.
        Environment-backed settings take effect immediately; saving a credential for a sidecar
        container (Lucid, slskd, Tailscale, Cloudflare Tunnel) only stores it — that container needs
        a restart to pick it up. Library sources have moved to their own screen at /sources.
      </ScreenDesc>

      <PanelSection title="API keys & credentials">
        <div className="grid gap-x-6 sm:grid-cols-2">
          <ApiKeyField label="Genius Access Token" settingKey="GENIUS_ACCESS_TOKEN" testEndpoint="/api/settings/genius" />
          <ApiKeyField label="Discogs User Token" settingKey="DISCOGS_USER_TOKEN" />
          <ApiKeyField label="AcoustID API Key" settingKey="ACOUSTID_API_KEY" />
          <ApiKeyField label="MusicBrainz Contact Email" settingKey="MUSICBRAINZ_CONTACT" />
        </div>
      </PanelSection>

      <PanelSection title="Playback">
        <PlaybackSection />
      </PanelSection>

      <PanelSection title="Backup">
        <BackupSection />
      </PanelSection>

      <PanelSection title="Remote Access">
        <div className="flex flex-col gap-3">
          <NoteBox
            notes={[
              <span key="intro">
                Reach this instance remotely without manually forwarding ports. Both options run as
                separate sidecar containers — saving a token here only stores it; re-run{' '}
                <code className="font-mono">docker compose up -d</code> (or target the specific
                service, e.g. <code className="font-mono">docker compose up -d tailscale</code>) for
                the sidecar to pick up the new credential. The Next.js app cannot restart sibling
                containers itself.
              </span>,
              <span key="tailscale">
                Tailscale joins this instance to your private tailnet — zero-config private remote
                access, no port forwarding. Generate a key from the Tailscale admin console
                (Settings → Keys).
              </span>,
            ]}
          />
          <ApiKeyField label="Tailscale Auth Key" settingKey="TAILSCALE_AUTHKEY" />

          <NoteBox
            notes={[
              <span key="cloudflare">
                Cloudflare Tunnel exposes this instance through Cloudflare&apos;s edge — good for
                sharing with others without exposing your home IP. Create a tunnel and copy its
                token from the Cloudflare Zero Trust dashboard (Networks → Tunnels).
              </span>,
              <span key="cloudflare-warning" className="text-warning">
                ⚠ Cloudflare&apos;s free/Pro tiers are meant for web traffic, not sustained
                high-bitrate audio streaming — routing lossless playback through an Argo tunnel for
                hours at a time risks tripping their ToS and getting the tunnel throttled or the
                domain flagged. Prefer Tailscale above for day-to-day listening; reach for Cloudflare
                Tunnel for occasional sharing, not as your primary streaming path.
              </span>,
            ]}
          />
          <ApiKeyField label="Cloudflare Tunnel Token" settingKey="CLOUDFLARE_TUNNEL_TOKEN" />
        </div>
      </PanelSection>

      <PanelSection title="Soulcatcher">
        <div className="flex flex-col gap-3">
          <NoteBox
            notes={[
              <span key="soulcatcher">
                Soulcatcher searches and downloads from the Soulseek network via the slskd sidecar.
                Saving credentials here stores them; re-run{' '}
                <code className="font-mono">docker compose up -d slskd</code> for slskd to pick them up.
              </span>,
            ]}
          />
          <div className="grid gap-x-6 sm:grid-cols-2">
            <ApiKeyField label="Soulseek Username" settingKey="SOULSEEK_USERNAME" />
            <ApiKeyField label="Soulseek Password" settingKey="SOULSEEK_PASSWORD" />
            <ApiKeyField label="slskd API Key" settingKey="SLSKD_API_KEY" />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Metadata">
        <MetadataSection />
      </PanelSection>

      <PanelSection title="Polyphony">
        <PolyphonySection />
      </PanelSection>

      <PanelSection title="Appearance">
        <p className="text-text-ghost text-[10.5px] text-center py-4">Theme variants coming soon.</p>
      </PanelSection>
    </div>
  )
}
