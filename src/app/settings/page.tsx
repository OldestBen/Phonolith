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

function ApiKeyField({ label, testEndpoint }: { label: string; testEndpoint?: string }) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  const handleTest = async () => {
    if (!testEndpoint) return
    setTestStatus('testing')
    try {
      const r = await fetch(testEndpoint)
      setTestStatus(r.ok ? 'ok' : 'fail')
    } catch {
      setTestStatus('fail')
    }
    setTimeout(() => setTestStatus('idle'), 4000)
  }

  return (
    <div className="mb-4">
      <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={`Enter ${label}…`}
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
      {testStatus === 'ok' && <p className="text-success text-xs mt-1">Connection successful</p>}
      {testStatus === 'fail' && <p className="text-danger text-xs mt-1">Connection failed — check your key</p>}
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
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleTest = async () => {
    setTesting('testing')
    try {
      const r = await fetch(`/api/library/sources/${source.id}/test`, { method: 'POST' })
      const d = await r.json()
      setTesting(d.ok ? 'ok' : 'fail')
    } catch {
      setTesting('fail')
    }
    setTimeout(() => setTesting('idle'), 5000)
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
    <div className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0">
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
          className="px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border text-text-muted text-xs hover:text-text-primary hover:border-accent/30 transition-colors disabled:opacity-50"
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

// ── Backup ────────────────────────────────────────────────────────────────────
function BackupSection() {
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [backing, setBacking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleBackup = async () => {
    setBacking(true)
    setStatus(null)
    try {
      const r = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, region }),
      })
      const data = await r.json()
      setStatus(data.message ?? (r.ok ? 'Backup started.' : 'Backup failed.'))
    } catch {
      setStatus('Backup failed — check your S3 configuration.')
    } finally {
      setBacking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">S3 Bucket</label>
          <input type="text" value={bucket} onChange={e => setBucket(e.target.value)} placeholder="my-phonolith-backup" className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors" />
        </div>
        <div>
          <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">Region</label>
          <input type="text" value={region} onChange={e => setRegion(e.target.value)} placeholder="us-east-1" className="bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleBackup} disabled={backing} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50">
          {backing ? 'Backing up…' : 'Backup Now'}
        </button>
        {status && <span className="text-text-muted text-sm">{status}</span>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-8">Settings</h1>

      <Section title="API Keys">
        <ApiKeyField label="Genius Access Token" testEndpoint="/api/search?q=test" />
        <ApiKeyField label="Discogs User Token" />
        <ApiKeyField label="AcoustID API Key" />
        <p className="text-text-muted text-xs mt-2">
          API keys are read from environment variables. Entering them here is for testing only — they are not persisted.
        </p>
      </Section>

      <Section title="Library Sources">
        <LibrarySourcesSection />
      </Section>

      <Section title="Backup">
        <BackupSection />
      </Section>

      <Section title="Appearance">
        <div className="bg-surface-2 rounded-xl border border-border p-6 text-center">
          <p className="text-text-muted text-sm">Theme variants coming soon.</p>
        </div>
      </Section>
    </div>
  )
}
