'use client'

import { useState, useEffect, useCallback } from 'react'
import type { HardwareProfile } from '@/lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEVICE_TYPE_LABELS: Record<string, string> = {
  system: 'System',
  dac: 'DAC',
  amp: 'Amplifier',
  speaker: 'Speaker System',
  headphone: 'Headphones',
  dap: 'DAP',
}

const DEVICE_TYPE_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'dac', label: 'DAC' },
  { value: 'amp', label: 'Amplifier' },
  { value: 'speaker', label: 'Speaker System' },
  { value: 'headphone', label: 'Headphones' },
  { value: 'dap', label: 'DAP' },
]

const PRESET_ROLES = ['DAC', 'Amplifier', 'Preamplifier', 'Speaker', 'Headphones', 'Cables', 'Transport']

// ── Types ─────────────────────────────────────────────────────────────────────

interface Component {
  role: string
  model: string
}

interface FormState {
  name: string
  description: string
  device_type: string
  lucid_device: string
  components: Component[]
}

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  device_type: 'system',
  lucid_device: '',
  components: [],
})

function profileToForm(p: HardwareProfile): FormState {
  return {
    name: p.name,
    description: p.description ?? '',
    device_type: p.device_type,
    lucid_device: p.lucid_device ?? '',
    components: p.components.map(c => ({ role: c.role, model: c.model })),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatHours(hours: number): string {
  if (hours === 0) return '0 hrs'
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} hrs`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ComponentChip({ role, model }: { role: string; model: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-2 border border-border text-xs">
      <span className="text-text-muted">{role}</span>
      {model && (
        <>
          <span className="text-border">·</span>
          <span className="text-text-primary">{model}</span>
        </>
      )}
    </span>
  )
}

function LucidBadge({ device }: { device: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-xs font-mono text-accent">
      {device}
    </span>
  )
}

// ── Inline form ───────────────────────────────────────────────────────────────

interface ProfileFormProps {
  initial: FormState
  onSave: (form: FormState) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function ProfileForm({ initial, onSave, onCancel, saving }: ProfileFormProps) {
  const [form, setForm] = useState<FormState>(initial)

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function addComponent() {
    setForm(prev => ({
      ...prev,
      components: [...prev.components, { role: '', model: '' }],
    }))
  }

  function updateComponent(idx: number, field: 'role' | 'model', value: string) {
    setForm(prev => {
      const components = prev.components.map((c, i) =>
        i === idx ? { ...c, [field]: value } : c
      )
      return { ...prev, components }
    })
  }

  function removeComponent(idx: number) {
    setForm(prev => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== idx),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await onSave(form)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface border border-accent/30 rounded-xl p-6 space-y-4"
    >
      {/* Name */}
      <div>
        <label className="block text-text-muted text-xs uppercase tracking-wider mb-1.5">
          Name <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={e => setField('name', e.target.value)}
          placeholder="e.g. Main System"
          required
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2
                     text-text-primary text-sm placeholder:text-text-muted
                     focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-text-muted text-xs uppercase tracking-wider mb-1.5">
          Description
        </label>
        <input
          type="text"
          value={form.description}
          onChange={e => setField('description', e.target.value)}
          placeholder="e.g. Chord Hugo TT2 → Sennheiser HD800S"
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2
                     text-text-primary text-sm placeholder:text-text-muted
                     focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Device type + Lucid device */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-text-muted text-xs uppercase tracking-wider mb-1.5">
            Device Type
          </label>
          <select
            value={form.device_type}
            onChange={e => setField('device_type', e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2
                       text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
          >
            {DEVICE_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-text-muted text-xs uppercase tracking-wider mb-1.5">
            Lucid ALSA Device
          </label>
          <input
            type="text"
            value={form.lucid_device}
            onChange={e => setField('lucid_device', e.target.value)}
            placeholder="e.g. hw:0,0"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2
                       text-text-primary text-sm font-mono placeholder:text-text-muted
                       focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* Components */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-text-muted text-xs uppercase tracking-wider">Components</label>
          <button
            type="button"
            onClick={addComponent}
            className="text-accent text-xs hover:text-accent/80 transition-colors"
          >
            + Add component
          </button>
        </div>

        {form.components.length === 0 ? (
          <p className="text-text-muted text-xs py-2">
            No components added. Click &quot;+ Add component&quot; to build your signal chain.
          </p>
        ) : (
          <div className="space-y-2">
            {form.components.map((comp, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  list="preset-roles"
                  value={comp.role}
                  onChange={e => updateComponent(idx, 'role', e.target.value)}
                  placeholder="Role"
                  className="w-36 bg-surface-2 border border-border rounded-lg px-3 py-1.5
                             text-text-primary text-sm placeholder:text-text-muted
                             focus:outline-none focus:border-accent transition-colors"
                />
                <input
                  type="text"
                  value={comp.model}
                  onChange={e => updateComponent(idx, 'model', e.target.value)}
                  placeholder="Model"
                  className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-1.5
                             text-text-primary text-sm placeholder:text-text-muted
                             focus:outline-none focus:border-accent transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeComponent(idx)}
                  className="text-text-muted hover:text-danger transition-colors text-sm px-1"
                  aria-label="Remove component"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <datalist id="preset-roles">
          {PRESET_ROLES.map(r => <option key={r} value={r} />)}
        </datalist>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="px-4 py-2 bg-accent text-background text-sm font-medium rounded-lg
                     hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 bg-surface-2 border border-border text-text-muted text-sm
                     rounded-lg hover:text-text-primary hover:border-accent/30 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Profile card ──────────────────────────────────────────────────────────────

interface ProfileCardProps {
  profile: HardwareProfile
  onEdit: () => void
  onDelete: () => void
  isEditing: boolean
  editForm: FormState
  onSaveEdit: (form: FormState) => Promise<void>
  onCancelEdit: () => void
  saving: boolean
}

function ProfileCard({
  profile,
  onEdit,
  onDelete,
  isEditing,
  editForm,
  onSaveEdit,
  onCancelEdit,
  saving,
}: ProfileCardProps) {
  return (
    <div
      className={`bg-surface border rounded-xl transition-colors ${
        isEditing ? 'border-accent/40' : 'border-border'
      }`}
    >
      {/* Card header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-text-primary font-semibold text-base leading-snug">
                {profile.name}
              </h3>
              <span className="text-text-muted text-xs border border-border rounded px-1.5 py-0.5">
                {DEVICE_TYPE_LABELS[profile.device_type] ?? profile.device_type}
              </span>
            </div>
            {profile.description && (
              <p className="text-text-muted text-sm mt-1 leading-snug">{profile.description}</p>
            )}
          </div>

          {/* Total hours */}
          <div className="shrink-0 text-right">
            {profile.total_hours > 0 ? (
              <p className="text-accent font-mono text-sm font-medium">
                {formatHours(profile.total_hours)}
              </p>
            ) : (
              <p className="text-text-muted text-xs">No hours logged</p>
            )}
          </div>
        </div>

        {/* Components */}
        {profile.components.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {profile.components.map((comp, i) => (
              <ComponentChip key={i} role={comp.role} model={comp.model} />
            ))}
          </div>
        )}

        {/* Lucid device badge */}
        {profile.lucid_device && (
          <div className="mb-3">
            <LucidBadge device={profile.lucid_device} />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="text-text-muted text-xs hover:text-text-primary transition-colors
                       border border-border rounded px-2.5 py-1 hover:border-accent/30"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-text-muted text-xs hover:text-danger transition-colors
                       border border-border rounded px-2.5 py-1 hover:border-danger/30"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {isEditing && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          <ProfileForm
            initial={editForm}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
            saving={saving}
          />
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CathodePage() {
  const [profiles, setProfiles] = useState<HardwareProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<FormState>(emptyForm())
  const [editSaving, setEditSaving] = useState(false)

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/cathode/profiles')
      if (res.ok) {
        const data = await res.json() as HardwareProfile[]
        setProfiles(data)
      }
    } catch {
      // silently fail — page still renders empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  async function handleAdd(form: FormState) {
    setAddSaving(true)
    try {
      const res = await fetch('/api/cathode/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          device_type: form.device_type,
          components: form.components.filter(c => c.role || c.model),
          lucid_device: form.lucid_device.trim() || undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json() as HardwareProfile
        setProfiles(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        setShowAddForm(false)
      }
    } finally {
      setAddSaving(false)
    }
  }

  function startEdit(profile: HardwareProfile) {
    setEditingId(profile.id)
    setEditForm(profileToForm(profile))
    setShowAddForm(false)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleEdit(form: FormState) {
    if (editingId === null) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/cathode/profiles/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          device_type: form.device_type,
          components: form.components.filter(c => c.role || c.model),
          lucid_device: form.lucid_device.trim() || null,
        }),
      })
      if (res.ok) {
        const updated = await res.json() as HardwareProfile
        setProfiles(prev =>
          prev
            .map(p => (p.id === editingId ? updated : p))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
        setEditingId(null)
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(id: number) {
    const profile = profiles.find(p => p.id === id)
    if (!profile) return
    if (!confirm(`Delete "${profile.name}"? This cannot be undone.`)) return

    const res = await fetch(`/api/cathode/profiles/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setProfiles(prev => prev.filter(p => p.id !== id))
      if (editingId === id) setEditingId(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20 md:pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-text-primary text-xl font-bold">Cathode</h1>
          <p className="text-text-muted text-sm mt-1">Hardware Endpoint Tracker</p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingId(null)
            }}
            className="shrink-0 px-4 py-2 bg-accent text-background text-sm font-medium rounded-lg
                       hover:bg-accent/90 transition-colors"
          >
            + Add Profile
          </button>
        )}
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <div className="mb-6">
          <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3 font-medium">
            New Profile
          </h2>
          <ProfileForm
            initial={emptyForm()}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saving={addSaving}
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 bg-surface-2 rounded-xl" />
          ))}
        </div>
      ) : profiles.length === 0 && !showAddForm ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <p className="text-text-muted text-sm leading-relaxed max-w-sm mx-auto">
            No hardware profiles yet. Add your first system to start tracking burn-in hours and
            listening sessions.
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="mt-4 px-4 py-2 bg-accent text-background text-sm font-medium rounded-lg
                       hover:bg-accent/90 transition-colors"
          >
            + Add Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {profiles.map(profile => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              onEdit={() => startEdit(profile)}
              onDelete={() => handleDelete(profile.id)}
              isEditing={editingId === profile.id}
              editForm={editForm}
              onSaveEdit={handleEdit}
              onCancelEdit={cancelEdit}
              saving={editSaving}
            />
          ))}
        </div>
      )}
    </div>
  )
}
