'use client'

import { useState } from 'react'

type SourceType = 'local' | 'smb' | 'nfs' | 'iscsi'

interface Props {
  onClose: () => void
  onSaved: () => void
}

const INPUT = 'bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors'
const LABEL = 'text-text-muted text-xs uppercase tracking-widest block mb-1.5'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
      {hint && <p className="text-text-muted text-[10px] mt-1">{hint}</p>}
    </div>
  )
}

export default function AddLibrarySource({ onClose, onSaved }: Props) {
  const [type, setType] = useState<SourceType>('local')
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, val: string) => setConfig(c => ({ ...c, [key]: val }))

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (type === 'smb' && !config.host) { setError('Host is required for SMB'); return }
    if (type === 'smb' && !config.share) { setError('Share name is required for SMB'); return }
    if ((type === 'local' || type === 'nfs' || type === 'iscsi') && !config.path) {
      setError('Path is required'); return
    }
    setSaving(true)
    setError(null)
    try {
      const r = await fetch('/api/library/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, config }),
      })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.error ?? 'Save failed')
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const typeLabels: Record<SourceType, string> = {
    local: 'Local Path',
    smb: 'SMB / Samba',
    nfs: 'NFS',
    iscsi: 'iSCSI',
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-text-primary text-base font-semibold">Add Library Source</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type tabs */}
          <div>
            <span className={LABEL}>Source Type</span>
            <div className="flex gap-2 flex-wrap">
              {(['local', 'smb', 'nfs', 'iscsi'] as SourceType[]).map(t => (
                <button
                  key={t}
                  onClick={() => { setType(t); setConfig({}) }}
                  className={`px-3 py-1.5 rounded-lg text-sm border font-medium transition-colors ${
                    type === t
                      ? 'bg-accent/20 border-accent/60 text-accent'
                      : 'bg-surface-2 border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {typeLabels[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Music Library"
              className={INPUT}
            />
          </Field>

          {/* Type-specific fields */}
          {type === 'local' && (
            <Field label="Path" hint="Path as seen inside the analyst container (e.g. /music)">
              <input type="text" value={config.path ?? ''} onChange={e => set('path', e.target.value)} placeholder="/music" className={INPUT} />
            </Field>
          )}

          {type === 'smb' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Host / IP">
                  <input type="text" value={config.host ?? ''} onChange={e => set('host', e.target.value)} placeholder="192.168.1.10" className={INPUT} />
                </Field>
                <Field label="Share Name">
                  <input type="text" value={config.share ?? ''} onChange={e => set('share', e.target.value)} placeholder="Music" className={INPUT} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <input type="text" value={config.username ?? ''} onChange={e => set('username', e.target.value)} placeholder="user" className={INPUT} autoComplete="off" />
                </Field>
                <Field label="Password">
                  <input type="password" value={config.password ?? ''} onChange={e => set('password', e.target.value)} placeholder="••••••" className={INPUT} autoComplete="new-password" />
                </Field>
              </div>
              <Field label="Domain" hint="Optional — leave blank for workgroup/home networks">
                <input type="text" value={config.domain ?? ''} onChange={e => set('domain', e.target.value)} placeholder="WORKGROUP" className={INPUT} />
              </Field>
              <Field label="Subfolder" hint="Optional — scan a specific folder within the share">
                <input type="text" value={config.subfolder ?? ''} onChange={e => set('subfolder', e.target.value)} placeholder="FLAC/Albums" className={INPUT} />
              </Field>
              <p className="text-text-muted text-[10px] bg-surface-2 rounded-lg px-3 py-2 border border-border/50">
                Files are streamed from the share for analysis. No files are written to your NAS.
              </p>
            </>
          )}

          {(type === 'nfs' || type === 'iscsi') && (
            <Field
              label="Mounted Path"
              hint={`Mount the ${type.toUpperCase()} share on your host first, then enter the resulting path (e.g. /Volumes/Music). Add it to Docker Desktop file sharing.`}
            >
              <input type="text" value={config.path ?? ''} onChange={e => set('path', e.target.value)} placeholder="/Volumes/Music" className={INPUT} />
            </Field>
          )}

          {error && <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-border text-text-muted text-sm hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Source'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
