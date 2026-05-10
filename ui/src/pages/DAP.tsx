import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  HardDrive, Play, Plus, Trash2, CheckCircle, XCircle, Clock, RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'

interface DapProfile {
  id: string
  name: string
  target_path: string
  storage_limit_gb: number
  max_bit_depth?: number
  max_sample_rate?: number
  filter_genre?: string
  filter_min_rating?: number
  filter_lossless_only: number
  rotation_policy: string
  created_at: string
}

interface SyncLog {
  id: string
  profile_id: string
  started_at: string
  finished_at?: string
  status: 'running' | 'done' | 'error'
  files_copied: number
  files_removed: number
  bytes_used: number
  error?: string
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'done') return (
    <span className="flex items-center gap-1 text-green-400 text-xs">
      <CheckCircle className="w-3.5 h-3.5" /> Done
    </span>
  )
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-red-400 text-xs">
      <XCircle className="w-3.5 h-3.5" /> Error
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-yellow-400 text-xs">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running
    </span>
  )
}

function fmtBytes(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`
  return `${b} B`
}

function ProfileCard({ profile }: { profile: DapProfile }) {
  const qc = useQueryClient()

  const { data: log = [] } = useQuery<SyncLog[]>({
    queryKey: ['dap-log', profile.id],
    queryFn: () => apiFetch(`/api/dap/profiles/${profile.id}/log?limit=5`),
    staleTime: 15_000,
    refetchInterval: 10_000,
  })

  const { mutate: triggerSync, isPending: syncing } = useMutation({
    mutationFn: () => apiFetch(`/api/dap/profiles/${profile.id}/sync`, { method: 'POST' }),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['dap-log', profile.id] }), 2000)
    },
  })

  const { mutate: remove } = useMutation({
    mutationFn: () => apiFetch(`/api/dap/profiles/${profile.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dap-profiles'] }),
  })

  const latest = log[0]

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-violet-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">{profile.name}</p>
            <p className="text-xs text-zinc-500 font-mono">{profile.target_path}</p>
          </div>
        </div>
        <button
          onClick={() => remove()}
          className="text-zinc-700 hover:text-red-400 transition-colors"
          title="Delete profile"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Config pills */}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
          {profile.storage_limit_gb} GB limit
        </span>
        {profile.filter_lossless_only ? (
          <span className="text-[10px] font-mono bg-violet-900/40 text-violet-300 px-2 py-0.5 rounded">
            lossless only
          </span>
        ) : null}
        {profile.max_bit_depth && (
          <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
            max {profile.max_bit_depth}-bit
          </span>
        )}
        {profile.max_sample_rate && (
          <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
            max {profile.max_sample_rate / 1000}kHz
          </span>
        )}
        {profile.filter_genre && (
          <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
            genre: {profile.filter_genre}
          </span>
        )}
        {profile.filter_min_rating && (
          <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
            ≥ {profile.filter_min_rating}★
          </span>
        )}
        <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
          rotation: {profile.rotation_policy}
        </span>
      </div>

      {/* Latest sync status */}
      {latest && (
        <div className="border border-zinc-800 rounded-lg p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <StatusBadge status={latest.status} />
            <span className="text-[10px] text-zinc-600 font-mono">
              {new Date(latest.started_at).toLocaleString()}
            </span>
          </div>
          {latest.status !== 'running' && (
            <div className="flex gap-3 text-xs text-zinc-500 font-mono">
              <span>{latest.files_copied} copied</span>
              <span>{latest.files_removed} removed</span>
              <span>{fmtBytes(latest.bytes_used)} used</span>
            </div>
          )}
          {latest.error && (
            <p className="text-xs text-red-400 font-mono">{latest.error}</p>
          )}
        </div>
      )}

      {/* Sync button */}
      <button
        onClick={() => triggerSync()}
        disabled={syncing || latest?.status === 'running'}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-medium transition-colors w-fit"
      >
        <Play className="w-3.5 h-3.5" />
        {syncing ? 'Queuing…' : 'Sync now'}
      </button>
    </div>
  )
}

function AddProfileForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [storageGb, setStorageGb] = useState('32')
  const [maxBitDepth, setMaxBitDepth] = useState('')
  const [maxSampleRate, setMaxSampleRate] = useState('')
  const [filterGenre, setFilterGenre] = useState('')
  const [filterMinRating, setFilterMinRating] = useState('')
  const [losslessOnly, setLosslessOnly] = useState(false)
  const [rotation, setRotation] = useState('keep')

  const { mutate: create, isPending } = useMutation({
    mutationFn: () => apiFetch('/api/dap/profiles', {
      method: 'POST',
      body: JSON.stringify({
        name,
        target_path: targetPath,
        storage_limit_gb: parseFloat(storageGb) || 32,
        max_bit_depth: maxBitDepth ? parseInt(maxBitDepth) : undefined,
        max_sample_rate: maxSampleRate ? parseInt(maxSampleRate) : undefined,
        filter_genre: filterGenre || undefined,
        filter_min_rating: filterMinRating ? parseFloat(filterMinRating) : undefined,
        filter_lossless_only: losslessOnly,
        rotation_policy: rotation,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dap-profiles'] })
      onClose()
    },
  })

  return (
    <div className="bg-zinc-900 border border-violet-800/50 rounded-xl p-5 flex flex-col gap-4 max-w-lg">
      <p className="text-sm font-semibold text-zinc-100">New DAP Profile</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Profile name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
            placeholder="My Walkman" />
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Target path (on host)</label>
          <input value={targetPath} onChange={e => setTargetPath(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 font-mono focus:outline-none focus:border-violet-600"
            placeholder="/mnt/sdcard" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Storage limit (GB)</label>
          <input value={storageGb} onChange={e => setStorageGb(e.target.value)} type="number"
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-600" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Rotation policy</label>
          <select value={rotation} onChange={e => setRotation(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-600">
            <option value="keep">keep (additive)</option>
            <option value="prune">prune (remove stale)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Max bit depth</label>
          <select value={maxBitDepth} onChange={e => setMaxBitDepth(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-600">
            <option value="">Any</option>
            <option value="16">16-bit</option>
            <option value="24">24-bit</option>
            <option value="32">32-bit</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Max sample rate</label>
          <select value={maxSampleRate} onChange={e => setMaxSampleRate(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-600">
            <option value="">Any</option>
            <option value="44100">44.1 kHz</option>
            <option value="48000">48 kHz</option>
            <option value="96000">96 kHz</option>
            <option value="192000">192 kHz</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Filter genre</label>
          <input value={filterGenre} onChange={e => setFilterGenre(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
            placeholder="Jazz" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Min star rating</label>
          <select value={filterMinRating} onChange={e => setFilterMinRating(e.target.value)}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-600">
            <option value="">Any</option>
            <option value="3">3★ +</option>
            <option value="4">4★ +</option>
            <option value="5">5★ only</option>
          </select>
        </div>

        <label className="col-span-2 flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={losslessOnly} onChange={e => setLosslessOnly(e.target.checked)}
            className="w-3.5 h-3.5 accent-violet-600" />
          <span className="text-sm text-zinc-300">Lossless files only (FLAC / ALAC / WAV)</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => create()}
          disabled={!name || !targetPath || isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Create profile
        </button>
        <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function DAP() {
  const [showForm, setShowForm] = useState(false)

  const { data: profiles = [], isLoading } = useQuery<DapProfile[]>({
    queryKey: ['dap-profiles'],
    queryFn: () => apiFetch('/api/dap/profiles'),
    staleTime: 30_000,
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">DAP Provisioning</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Sync curated subsets of your library to SD cards and USB drives for portable players.
            Profiles define format caps, storage limits, genre filters, and rotation rules.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            showForm
              ? 'bg-zinc-800 text-zinc-400'
              : 'bg-violet-700 hover:bg-violet-600 text-white',
          )}
        >
          <Plus className="w-3.5 h-3.5" /> New profile
        </button>
      </div>

      {showForm && <AddProfileForm onClose={() => setShowForm(false)} />}

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : profiles.length === 0 && !showForm ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <HardDrive className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm">No DAP profiles yet.</p>
          <p className="text-xs text-zinc-600 max-w-xs">
            Create a profile to define which tracks sync to which device.
            The target path must be a directory accessible inside the container.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map(p => <ProfileCard key={p.id} profile={p} />)}
        </div>
      )}
    </div>
  )
}
