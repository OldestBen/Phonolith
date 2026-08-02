'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { HardwareProfile } from '@/lib/types'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { ScreenDesc, CanvasPanel, InfoCard, C, type CardSpec } from '@/components/panel'

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

// Rotating ring palette for the burn-in dial + legend. Index 0 (the endpoint
// with the most tracked hours) always gets the amber "peak" highlight, the
// rest cycle through this so no two adjacent rings share a color.
const RING_PALETTE = [C.vio, C.green, C.yel, C.orange, C.dim]
function ringColor(rank: number): string {
  return rank === 0 ? C.amb : RING_PALETTE[(rank - 1) % RING_PALETTE.length]
}

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

function formatHoursShort(hours: number): string {
  return `${hours.toFixed(1)}h`
}

// ── Inline form (shared by "add" + "edit") ────────────────────────────────────

interface ProfileFormProps {
  initial: FormState
  onSave: (form: FormState) => Promise<void>
  onCancel: () => void
  saving: boolean
}

const inputClass =
  'w-full rounded-md border border-[#3f3f46] bg-[#0a0a0c] px-[9px] py-1.5 text-[11px] text-text-secondary ' +
  'shadow-[inset_0_0_10px_rgba(0,0,0,.7)] placeholder:text-text-ghost focus:outline-none focus:border-accent-dim transition-colors'

const labelClass = 'block text-[9px] uppercase tracking-[.16em] text-text-ghost mb-1.5'

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
      className="rounded-[10px] border border-border bg-[#101012] px-[15px] py-[13px] space-y-4"
    >
      {/* Name */}
      <div>
        <label className={labelClass}>
          Name <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={e => setField('name', e.target.value)}
          placeholder="e.g. Main System"
          required
          className={inputClass}
        />
      </div>

      {/* Description */}
      <div>
        <label className={labelClass}>Description</label>
        <input
          type="text"
          value={form.description}
          onChange={e => setField('description', e.target.value)}
          placeholder="e.g. Chord Hugo TT2 → Sennheiser HD800S"
          className={inputClass}
        />
      </div>

      {/* Device type + Lucid device */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Device Type</label>
          <select
            value={form.device_type}
            onChange={e => setField('device_type', e.target.value)}
            className={inputClass}
          >
            {DEVICE_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Lucid ALSA Device</label>
          <input
            type="text"
            value={form.lucid_device}
            onChange={e => setField('lucid_device', e.target.value)}
            placeholder="e.g. hw:0,0"
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {/* Components */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[9px] uppercase tracking-[.16em] text-text-ghost">Components</label>
          <button
            type="button"
            onClick={addComponent}
            className="text-accent text-[10.5px] hover:text-accent-bright transition-colors"
          >
            + Add component
          </button>
        </div>

        {form.components.length === 0 ? (
          <p className="text-text-ghost text-[10.5px] py-2">
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
                  className={`w-36 ${inputClass}`}
                />
                <input
                  type="text"
                  value={comp.model}
                  onChange={e => updateComponent(idx, 'model', e.target.value)}
                  placeholder="Model"
                  className={`flex-1 ${inputClass}`}
                />
                <button
                  type="button"
                  onClick={() => removeComponent(idx)}
                  className="text-text-ghost hover:text-danger transition-colors text-sm px-1"
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
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="rounded-md px-[13px] py-1.5 text-[10.5px] font-medium text-white shadow-[0_0_15px_rgba(109,40,217,.45)] hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#6d28d9' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-[#3f3f46] bg-surface px-[13px] py-1.5 text-[10.5px] text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Card content builder ──────────────────────────────────────────────────────

function profileToCard(
  profile: HardwareProfile,
  maxHours: number,
  rank: number,
  onAction: (label: string) => void
): CardSpec {
  const deviceLabel = DEVICE_TYPE_LABELS[profile.device_type] ?? profile.device_type
  const compSummary = profile.components.map(c => (c.model ? `${c.role}: ${c.model}` : c.role))
  const subParts = [deviceLabel, ...compSummary.slice(0, 2), profile.description].filter(Boolean)
  if (compSummary.length > 2) subParts.splice(3, 0, `+${compSummary.length - 2} more`)

  const pills = [deviceLabel, ...compSummary]
  if (profile.lucid_device) pills.push(`ALSA ${profile.lucid_device}`)

  return {
    title: profile.name,
    sub: subParts.join(' · '),
    dot: profile.total_hours > 0 ? ringColor(rank) : C.faint,
    pills,
    bar: maxHours > 0 ? (profile.total_hours / maxHours) * 100 : 0,
    barColor: ringColor(rank),
    barLabel: formatHoursShort(profile.total_hours),
    actions: [['Edit', false], ['Delete', false]],
    onAction,
  }
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

  usePageHeader(
    'Cathode',
    `burn-in accountant · ${profiles.length} endpoint${profiles.length === 1 ? '' : 's'} tracked`
  )

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

  // ── Burn-in dial ──────────────────────────────────────────────────────────
  // Lucid only ever reports a running `total_hours` counter per profile — the
  // history log has no hour-of-day/day-of-week breakdown available through
  // the Cathode API, so a "24h x 7d" heatmap dial (as sketched in the design
  // mockup) would have to be fabricated. Instead this draws an honest radial
  // gauge: one ring-segment per profile, sized by its real share of total
  // tracked hours. The slow rotating sweep line is purely decorative (a
  // "live" cue, like a radar sweep) — it carries no data of its own.
  const profilesRef = useRef<HardwareProfile[]>([])
  useEffect(() => {
    profilesRef.current = profiles
  }, [profiles])

  const drawDial = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    ctx.clearRect(0, 0, w, h)
    const list = profilesRef.current
    const cx = w / 2
    const cy = h / 2 + 4
    const outerR = Math.min(w, h) * 0.34
    const innerR = outerR * 0.6
    const midR = (outerR + innerR) / 2
    const total = list.reduce((s, p) => s + p.total_hours, 0)

    // Faint always-visible track ring.
    ctx.beginPath()
    ctx.arc(cx, cy, midR, 0, Math.PI * 2)
    ctx.lineWidth = outerR - innerR
    ctx.strokeStyle = 'rgba(255,255,255,.045)'
    ctx.stroke()

    if (total > 0) {
      const sorted = [...list].filter(p => p.total_hours > 0).sort((a, b) => b.total_hours - a.total_hours)
      let angle = -Math.PI / 2
      sorted.forEach((p, i) => {
        const sweep = (p.total_hours / total) * Math.PI * 2
        const color = ringColor(i)
        ctx.beginPath()
        ctx.arc(cx, cy, midR, angle, angle + Math.max(sweep - 0.015, 0.001))
        ctx.lineWidth = outerR - innerR
        ctx.strokeStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = i === 0 ? 16 : 7
        ctx.stroke()
        angle += sweep
      })
    }
    ctx.shadowBlur = 0

    // Decorative slow radar sweep — cosmetic motion only, not a data channel.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((t * 0.3) % (Math.PI * 2))
    const grad = ctx.createLinearGradient(0, 0, outerR + 6, 0)
    grad.addColorStop(0, 'rgba(255,179,64,0)')
    grad.addColorStop(1, 'rgba(255,179,64,.4)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(innerR - 4, 0)
    ctx.lineTo(outerR + 6, 0)
    ctx.stroke()
    ctx.restore()

    // Center readout.
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (total > 0) {
      ctx.font = '700 19px ui-monospace, "JetBrains Mono", monospace'
      ctx.fillStyle = C.amb
      ctx.shadowColor = 'rgba(255,179,64,.55)'
      ctx.shadowBlur = 10
      ctx.fillText(total.toFixed(1), cx, cy - 6)
      ctx.shadowBlur = 0
      ctx.font = '500 8.5px ui-monospace, "JetBrains Mono", monospace'
      ctx.fillStyle = C.mut
      ctx.fillText('TOTAL HOURS TRACKED', cx, cy + 12)
    } else {
      ctx.font = '500 10px ui-monospace, "JetBrains Mono", monospace'
      ctx.fillStyle = C.faint
      ctx.fillText('no hours logged yet', cx, cy)
    }
  }, [])

  // ── CRUD ──────────────────────────────────────────────────────────────────

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const maxHours = Math.max(1, ...profiles.map(p => p.total_hours))
  const rankById = new Map(
    [...profiles]
      .filter(p => p.total_hours > 0)
      .sort((a, b) => b.total_hours - a.total_hours)
      .map((p, i) => [p.id, i])
  )
  const legendOrder = [...profiles].sort((a, b) => b.total_hours - a.total_hours)

  return (
    <div className="max-w-3xl px-4 py-8 pb-20 md:pb-8 flex flex-col gap-3.5">
      {/* Description + add-profile action */}
      <div className="flex items-start justify-between gap-4">
        <ScreenDesc>
          Burn-in accountant — tracks accumulated playback hours per hardware endpoint. Each
          profile&apos;s total climbs automatically whenever Lucid finishes streaming a track to its
          ALSA device; nothing here is estimated.
        </ScreenDesc>
        {!showAddForm && (
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingId(null)
            }}
            className="shrink-0 rounded-md px-[13px] py-1.5 text-[10.5px] font-medium text-white shadow-[0_0_15px_rgba(109,40,217,.45)] hover:bg-accent-dim transition-colors"
            style={{ background: '#6d28d9' }}
          >
            + Add Profile
          </button>
        )}
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[9px] uppercase tracking-[.2em] text-text-ghost">New Profile</p>
          <ProfileForm
            initial={emptyForm()}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saving={addSaving}
          />
        </div>
      )}

      {/* Burn-in dial */}
      <div className="flex flex-col gap-2.5">
        <CanvasPanel
          title="Burn-in dial · hours by endpoint"
          subtitle={
            profiles.length > 0
              ? 'each arc = share of total tracked hours · amber = most-used endpoint'
              : 'add a profile to start tracking burn-in hours'
          }
          height={280}
          background="radial-gradient(circle at 50% 50%,#151024 0%,#09090c 72%)"
          draw={drawDial}
        />
        {legendOrder.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
            {legendOrder.map(p => {
              const rank = rankById.get(p.id)
              const color = rank != null ? ringColor(rank) : C.faint
              return (
                <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                  />
                  <span className="text-text-muted">{p.name}</span>
                  <span className="text-text-ghost">{formatHoursShort(p.total_hours)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Profiles */}
      {loading ? (
        <div className="flex flex-col gap-2.5 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-[9px] border border-border bg-surface" />
          ))}
        </div>
      ) : profiles.length === 0 && !showAddForm ? (
        <div className="text-center py-16 border border-dashed border-border rounded-[10px]">
          <p className="text-text-faint text-[11px] leading-relaxed max-w-sm mx-auto">
            No hardware profiles yet. Add your first system to start tracking burn-in hours and
            listening sessions.
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="mt-4 rounded-md px-[13px] py-1.5 text-[10.5px] font-medium text-white shadow-[0_0_15px_rgba(109,40,217,.45)] hover:bg-accent-dim transition-colors"
            style={{ background: '#6d28d9' }}
          >
            + Add Profile
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {profiles.map(profile => {
            const isEditing = editingId === profile.id
            const rank = rankById.get(profile.id) ?? profiles.length
            return (
              <div key={profile.id}>
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <p className="m-0 text-[9px] uppercase tracking-[.2em] text-text-ghost">
                      Editing · {profile.name}
                    </p>
                    <ProfileForm
                      initial={editForm}
                      onSave={handleEdit}
                      onCancel={cancelEdit}
                      saving={editSaving}
                    />
                  </div>
                ) : (
                  <InfoCard
                    card={profileToCard(profile, maxHours, rank, label => {
                      if (label === 'Edit') startEdit(profile)
                      else if (label === 'Delete') handleDelete(profile.id)
                    })}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
