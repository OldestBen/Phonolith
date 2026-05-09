import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEQProfiles, createEQProfile, deleteEQProfile, type EQProfile } from '../lib/api'
import { SlidersHorizontal, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

const inputCls = "w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
const labelCls = "text-[10px] text-zinc-500 uppercase tracking-widest"

function ProfileCard({ profile, onDelete }: { profile: EQProfile; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  let bands: unknown[] = []
  try { bands = profile.peq_json ? JSON.parse(profile.peq_json) : [] } catch {}

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <span className="text-zinc-500">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <SlidersHorizontal className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100">{profile.label}</p>
          <p className="text-xs text-zinc-500">
            {profile.album_id ? `album scope` : profile.blake3_hash ? `track scope` : 'global'}
            {bands.length > 0 ? ` · ${bands.length} PEQ bands` : ''}
            {profile.convolution_file_path ? ' · convolution' : ''}
          </p>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono hidden md:block">
          {new Date(profile.created_at).toLocaleDateString()}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1.5 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors"
          title="Delete profile"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-4 flex flex-col gap-3">
          {bands.length > 0 && (
            <div>
              <p className={clsx(labelCls, "mb-2")}>PEQ bands</p>
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-600 border-b border-zinc-800 text-left">
                      <th className="px-3 py-1.5 font-medium">#</th>
                      <th className="px-3 py-1.5 font-medium">Freq (Hz)</th>
                      <th className="px-3 py-1.5 font-medium">Gain (dB)</th>
                      <th className="px-3 py-1.5 font-medium">Q</th>
                      <th className="px-3 py-1.5 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bands as Record<string, unknown>[]).map((b, i) => (
                      <tr key={i} className="border-b border-zinc-800/40">
                        <td className="px-3 py-1.5 text-zinc-500">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-zinc-300">{String(b.freq ?? b.frequency ?? '—')}</td>
                        <td className={clsx('px-3 py-1.5 font-mono font-bold',
                          Number(b.gain) > 0 ? 'text-yellow-400' : Number(b.gain) < 0 ? 'text-blue-400' : 'text-zinc-400'
                        )}>
                          {Number(b.gain) > 0 ? '+' : ''}{String(b.gain ?? '0')}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-zinc-400">{String(b.q ?? b.Q ?? '—')}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{String(b.type ?? b.filter_type ?? 'PK')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {profile.convolution_file_path && (
            <div>
              <p className={clsx(labelCls, "mb-1")}>Convolution file</p>
              <p className="font-mono text-xs text-zinc-400 break-all">{profile.convolution_file_path}</p>
            </div>
          )}

          {profile.notes && (
            <div>
              <p className={clsx(labelCls, "mb-1")}>Notes</p>
              <p className="text-xs text-zinc-400">{profile.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NewProfileForm({ onSave }: { onSave: () => void }) {
  const [label, setLabel] = useState('')
  const [peqJson, setPeqJson] = useState('')
  const [convPath, setConvPath] = useState('')
  const [notes, setNotes] = useState('')
  const [albumId, setAlbumId] = useState('')
  const [hash, setHash] = useState('')
  const [jsonError, setJsonError] = useState('')

  const qc = useQueryClient()
  const { mutate, isPending } = useMutation({
    mutationFn: () => createEQProfile({
      label,
      peq_json: peqJson || undefined,
      convolution_file_path: convPath || undefined,
      notes: notes || undefined,
      album_id: albumId || undefined,
      blake3_hash: hash || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['eq-profiles'] }); onSave() },
  })

  function validateJson(v: string) {
    setPeqJson(v)
    if (!v) { setJsonError(''); return }
    try { JSON.parse(v); setJsonError('') } catch { setJsonError('Invalid JSON') }
  }

  return (
    <div className="bg-zinc-900 border border-violet-800/40 rounded-xl p-5 flex flex-col gap-4">
      <p className="text-sm font-medium text-zinc-200">New EQ profile</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Label *</label>
          <input className={inputCls} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Tame harsh treble" />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Album ID (scope to album)</label>
          <input className={inputCls} value={albumId} onChange={e => setAlbumId(e.target.value)} placeholder="optional" />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>BLAKE3 hash (scope to track)</label>
          <input className={inputCls} value={hash} onChange={e => setHash(e.target.value)} placeholder="optional" />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Convolution file path</label>
          <input className={inputCls} value={convPath} onChange={e => setConvPath(e.target.value)} placeholder="/data/ir/my_room.wav" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className={clsx(labelCls, jsonError ? 'text-red-400' : '')}>
          PEQ bands JSON {jsonError && `— ${jsonError}`}
        </label>
        <textarea
          className={clsx(inputCls, 'font-mono text-xs h-24 resize-none', jsonError && 'border-red-500')}
          value={peqJson}
          onChange={e => validateJson(e.target.value)}
          placeholder={'[{"freq": 4000, "gain": -3, "q": 1.4, "type": "PK"}]'}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Notes</label>
        <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => mutate()}
          disabled={!label || !!jsonError || isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Save profile
        </button>
        <button onClick={onSave} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function EQProfiles() {
  const [showForm, setShowForm] = useState(false)
  const qc = useQueryClient()

  const { data: profiles = [], isLoading } = useQuery<EQProfile[]>({
    queryKey: ['eq-profiles'],
    queryFn: () => getEQProfiles(),
    staleTime: 30_000,
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteEQProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eq-profiles'] }),
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">EQ Profiles</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Per-album or per-track parametric EQ and convolution settings. Profiles travel with the
            library — export them to your DAP or player via the Codex.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> New profile
          </button>
        )}
      </div>

      {showForm && <NewProfileForm onSave={() => setShowForm(false)} />}

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : profiles.length === 0 && !showForm ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <SlidersHorizontal className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm">No EQ profiles yet. Create one to attach PEQ or convolution settings to an album.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {profiles.map(p => (
            <ProfileCard key={p.id} profile={p} onDelete={() => remove(p.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
