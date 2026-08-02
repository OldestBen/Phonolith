'use client'

/**
 * Standalone "Sources" screen — extracted out of Settings so library-source
 * management gets its own dedicated screen (matches the Claude Design mockup's
 * `P.sources`). Data logic (list/test/scan/delete/add) is unchanged from the
 * old `LibrarySourcesSection`/`SourceRow` that used to live in
 * src/app/settings/page.tsx — only the presentation moved onto the shared
 * "instrument panel" primitives.
 */

import { useCallback, useEffect, useState } from 'react'
import type { LibrarySource } from '@/lib/types'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import AddLibrarySource from '@/components/AddLibrarySource'
import { ScreenDesc, CardGrid, FieldsPanel, NoteBox, C, type CardSpec } from '@/components/panel'

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Mirrors the old SourceRow's path/host summary line. */
function sourceSummary(source: LibrarySource): string {
  if (source.type === 'smb') {
    const cfg = source.config ?? {}
    return `smb://${cfg.host ?? ''}/${cfg.share ?? ''}${cfg.subfolder ? '/' + cfg.subfolder : ''}`
  }
  return source.config?.path ?? ''
}

/** Type/config-derived tags — inferred from real config fields, nothing fabricated. */
function pillsFor(source: LibrarySource): string[] {
  const cfg = source.config ?? {}
  switch (source.type) {
    case 'smb': {
      const pills = ['SMB/CIFS']
      if (cfg.username || cfg.password) pills.push('AES-256-GCM creds')
      if (cfg.domain) pills.push(`domain: ${cfg.domain}`)
      if (cfg.subfolder) pills.push(`subfolder: ${cfg.subfolder}`)
      return pills
    }
    case 'nfs':
      return ['NFS mount']
    case 'iscsi':
      return ['iSCSI target']
    default:
      return ['local mount']
  }
}

interface RowState {
  testing?: boolean
  scanning?: boolean
  deleting?: boolean
  message?: string
}

export default function LibrarySourcesPanel() {
  const [sources, setSources] = useState<LibrarySource[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [rowState, setRowState] = useState<Record<number, RowState>>({})

  const load = useCallback(() => {
    fetch('/api/library/sources')
      .then(r => (r.ok ? r.json() : []))
      .then(setSources)
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  usePageHeader('Sources', `${sources.length} source${sources.length === 1 ? '' : 's'} · watched by Tremor`)

  const patchRow = (id: number, patch: RowState) =>
    setRowState(s => ({ ...s, [id]: { ...s[id], ...patch } }))

  const handleTest = async (source: LibrarySource) => {
    if (rowState[source.id]?.testing) return
    patchRow(source.id, { testing: true, message: undefined })
    try {
      const r = await fetch(`/api/library/sources/${source.id}/test`, { method: 'POST' })
      const d = await r.json()
      patchRow(source.id, {
        testing: false,
        message: d.ok
          ? typeof d.files_found === 'number'
            ? `✓ Connected · ${d.files_found} file${d.files_found === 1 ? '' : 's'} visible`
            : '✓ Connected'
          : `✗ ${d.error ?? 'Test failed'}`,
      })
    } catch {
      patchRow(source.id, { testing: false, message: '✗ Could not reach analyst sidecar' })
    }
    setTimeout(() => patchRow(source.id, { message: undefined }), 12000)
  }

  const handleScan = async (source: LibrarySource) => {
    if (rowState[source.id]?.scanning) return
    patchRow(source.id, { scanning: true, message: undefined })
    try {
      await fetch(`/api/library/sources/${source.id}/scan`, { method: 'POST' })
      patchRow(source.id, { scanning: false, message: '✓ Scan triggered' })
      load()
    } catch {
      patchRow(source.id, { scanning: false, message: '✗ Scan failed' })
    }
    setTimeout(() => patchRow(source.id, { message: undefined }), 6000)
  }

  const handleDelete = async (source: LibrarySource) => {
    if (!confirm(`Delete source "${source.name}"?`)) return
    patchRow(source.id, { deleting: true })
    await fetch(`/api/library/sources/${source.id}`, { method: 'DELETE' })
    load()
  }

  const onCardAction = (source: LibrarySource) => (label: string) => {
    if (label.startsWith('Scan')) handleScan(source)
    else if (label.startsWith('Test')) handleTest(source)
    else if (label.startsWith('Remov')) handleDelete(source)
  }

  const cards: CardSpec[] = sources.map(source => {
    const rs = rowState[source.id] ?? {}
    const offline = source.status !== 'ok'
    const dot = source.status === 'ok' ? C.green : source.status === 'offline' ? C.yel : C.red
    const badgeColor = source.status === 'ok' ? C.mut : source.status === 'offline' ? C.yel : C.red
    const badge = offline
      ? `⚠ ${source.status}${source.offline_since ? ' since ' + new Date(source.offline_since).toLocaleDateString() : ''}`
      : `scanned ${timeAgo(source.last_scanned_at)}`

    return {
      title: source.name,
      sub: sourceSummary(source),
      badge,
      badgeColor,
      dot,
      pills: pillsFor(source),
      actions: [
        [rs.scanning ? 'Scanning…' : 'Scan', false],
        [rs.testing ? 'Testing…' : 'Test', false],
        [rs.deleting ? 'Removing…' : 'Remove', false],
      ],
      foot: rs.message ?? (offline && source.last_seen_at ? `Last seen ${new Date(source.last_seen_at).toLocaleString()}` : undefined),
      onAction: onCardAction(source),
    }
  })

  const localCount = sources.filter(s => s.type === 'local').length
  const networkCount = sources.length - localCount

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[13px] px-6 py-6">
      <ScreenDesc>
        Configure which directories Tremor watches for audio files. Changes take effect immediately.
      </ScreenDesc>

      {sources.length > 0 ? (
        <CardGrid columns={false} cards={cards} />
      ) : (
        <div className="rounded-[10px] border border-border bg-surface px-4 py-6 text-center">
          <p className="m-0 text-sm text-text-muted">No library sources configured yet.</p>
          <p className="mt-1 text-xs text-text-ghost">Add a local path, SMB share, NFS, or iSCSI target below.</p>
        </div>
      )}

      <FieldsPanel
        title="Add library source"
        fields={[
          { label: 'Total sources', value: String(sources.length) },
          { label: 'Local mounts', value: String(localCount), mono: true },
          { label: 'Network shares', value: String(networkCount), mono: true },
        ]}
        action="+ Add source"
        onAction={() => setShowAdd(true)}
      />

      <NoteBox
        notes={[
          'Credentials for SMB sources are encrypted at rest with AES-256-GCM (CREDENTIAL_KEY) before they touch the database — plaintext passwords are never stored or returned by the API.',
          'Adding a source takes effect immediately: the analyst sidecar starts watching the new path with no restart required.',
          'Removing a source stops future scans of that path but does not delete already-indexed files or their metadata.',
        ]}
      />

      {showAdd && <AddLibrarySource onClose={() => setShowAdd(false)} onSaved={load} />}
    </div>
  )
}
