'use client'

import { useState, useEffect } from 'react'

// ── Section wrapper ───────────────────────────────────────────────────────────
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

// ── API key field ─────────────────────────────────────────────────────────────
function ApiKeyField({
  label,
  envKey,
  testEndpoint,
}: {
  label: string
  envKey: string
  testEndpoint?: string
}) {
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
      <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={`Enter ${label}…`}
            className="bg-background border border-border text-text-primary text-sm rounded-lg
                       px-3 py-2 w-full pr-10 focus:outline-none focus:border-accent transition-colors"
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary
                       transition-colors text-xs"
            aria-label={show ? 'Hide' : 'Show'}
          >
            {show ? '🙈' : '👁'}
          </button>
        </div>
        {testEndpoint && (
          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="px-3 py-2 rounded-lg bg-surface-2 border border-border text-text-primary text-sm
                       font-medium hover:bg-surface transition-colors disabled:opacity-50 shrink-0"
          >
            {testStatus === 'testing' ? '…'
              : testStatus === 'ok' ? '✓'
              : testStatus === 'fail' ? '✗'
              : 'Test'}
          </button>
        )}
      </div>
      {testStatus === 'ok' && (
        <p className="text-success text-xs mt-1">Connection successful</p>
      )}
      {testStatus === 'fail' && (
        <p className="text-danger text-xs mt-1">Connection failed — check your key</p>
      )}
    </div>
  )
}

// ── Library status ────────────────────────────────────────────────────────────
interface LibraryStatus {
  library_path?: string
  watcher_status?: string
  file_count?: number
  last_scan?: string
}

// ── Backup section ────────────────────────────────────────────────────────────
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
          <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">
            S3 Bucket
          </label>
          <input
            type="text"
            value={bucket}
            onChange={e => setBucket(e.target.value)}
            placeholder="my-phonolith-backup"
            className="bg-background border border-border text-text-primary text-sm rounded-lg
                       px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div>
          <label className="text-text-muted text-xs uppercase tracking-widest block mb-1.5">
            Region
          </label>
          <input
            type="text"
            value={region}
            onChange={e => setRegion(e.target.value)}
            placeholder="us-east-1"
            className="bg-background border border-border text-text-primary text-sm rounded-lg
                       px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleBackup}
          disabled={backing}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium
                     hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {backing ? 'Backing up…' : 'Backup Now'}
        </button>
        {status && (
          <span className="text-text-muted text-sm">{status}</span>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [libStatus, setLibStatus] = useState<LibraryStatus>({})
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/library/status')
      .then(r => r.ok ? r.json() : {})
      .then(data => setLibStatus(data))
      .catch(() => {})
  }, [])

  const handleScan = async () => {
    setScanning(true)
    setScanMsg(null)
    try {
      const r = await fetch('/api/library/scan', { method: 'POST' })
      const data = await r.json()
      setScanMsg(data.message ?? 'Scan started.')
    } catch {
      setScanMsg('Scan failed.')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20 md:pb-8">
      <h1 className="text-text-primary text-xl font-bold mb-8">Settings</h1>

      {/* 1. API Keys */}
      <Section title="API Keys">
        <ApiKeyField
          label="Genius Access Token"
          envKey="GENIUS_ACCESS_TOKEN"
          testEndpoint="/api/search?q=test"
        />
        <ApiKeyField
          label="Discogs User Token"
          envKey="DISCOGS_USER_TOKEN"
        />
        <ApiKeyField
          label="AcoustID API Key"
          envKey="ACOUSTID_API_KEY"
        />
        <p className="text-text-muted text-xs mt-2">
          API keys are read from environment variables. Entering them here is for testing only
          — they are not persisted.
        </p>
      </Section>

      {/* 2. Library */}
      <Section title="Library">
        <div className="space-y-3">
          <div className="flex items-start gap-4 py-2.5 border-b border-border/50">
            <span className="text-text-muted text-sm w-36 shrink-0">Library path</span>
            <span className="text-text-primary text-sm font-mono break-all">
              {libStatus.library_path ?? '—'}
            </span>
          </div>
          <div className="flex items-center gap-4 py-2.5 border-b border-border/50">
            <span className="text-text-muted text-sm w-36 shrink-0">Watcher</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium ${
                libStatus.watcher_status === 'online'
                  ? 'bg-success/10 border-success/20 text-success'
                  : 'bg-surface-2 border-border text-text-muted'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  libStatus.watcher_status === 'online' ? 'bg-success' : 'bg-text-muted'
                }`}
              />
              {libStatus.watcher_status ?? 'unknown'}
            </span>
          </div>
          <div className="flex items-center gap-4 py-2.5 border-b border-border/50">
            <span className="text-text-muted text-sm w-36 shrink-0">Files indexed</span>
            <span className="text-text-primary text-sm font-mono">
              {libStatus.file_count != null ? libStatus.file_count.toLocaleString() : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-4 py-2 rounded-lg bg-surface-2 border border-border text-text-primary text-sm
                         font-medium hover:bg-surface transition-colors disabled:opacity-50"
            >
              {scanning ? 'Scanning…' : 'Scan Now'}
            </button>
            {scanMsg && <span className="text-text-muted text-sm">{scanMsg}</span>}
          </div>
        </div>
      </Section>

      {/* 3. Backup */}
      <Section title="Backup">
        <BackupSection />
      </Section>

      {/* 4. Appearance */}
      <Section title="Appearance">
        <div className="bg-surface-2 rounded-xl border border-border p-6 text-center">
          <p className="text-text-muted text-sm">Theme variants coming soon.</p>
        </div>
      </Section>
    </div>
  )
}
