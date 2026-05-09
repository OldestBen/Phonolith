import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSources, addSource, deleteSource, type LibrarySource } from '../lib/api'
import { FolderOpen, Plus, Trash2, HardDrive, Info } from 'lucide-react'
import clsx from 'clsx'

function SourceCard({ source, onDelete }: { source: LibrarySource; onDelete: (id: string) => void }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
      <HardDrive className="h-4 w-4 flex-shrink-0 text-violet-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-100">{source.name}</p>
        <p className="font-mono text-xs text-zinc-500 truncate">{source.path}</p>
      </div>
      <button
        onClick={() => onDelete(source.id)}
        className="rounded p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
        title="Remove source"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function AddSourceForm({ onAdd }: { onAdd: () => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const qc = useQueryClient()

  const mut = useMutation({
    mutationFn: () => addSource(name.trim(), path.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['status'] })
      setName('')
      setPath('')
      onAdd()
    },
  })

  const valid = name.trim().length > 0 && path.trim().length > 0

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Add library source</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-600 uppercase tracking-widest">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Main Library"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-600 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-600 uppercase tracking-widest">Path (container path)</label>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="/library"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-600 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => mut.mutate()}
          disabled={!valid || mut.isPending}
          className={clsx(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            valid && !mut.isPending
              ? 'bg-violet-600 text-white hover:bg-violet-500'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          {mut.isPending ? 'Adding…' : 'Add source'}
        </button>
        {mut.isError && (
          <p className="text-xs text-red-400">Failed to add source</p>
        )}
      </div>
    </div>
  )
}

function DocNote() {
  return (
    <div className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <Info className="h-4 w-4 flex-shrink-0 text-zinc-500 mt-0.5" />
      <div className="text-xs text-zinc-500 space-y-1.5">
        <p>
          The <span className="font-mono text-zinc-400">path</span> must be a directory already
          mounted into the Tremor container. By default, <span className="font-mono text-zinc-400">LIBRARY_PATH</span> is
          mounted at <span className="font-mono text-zinc-400">/library</span>.
        </p>
        <p>
          To add a new host directory, add a volume mount in{' '}
          <span className="font-mono text-zinc-400">docker-compose.yml</span> then enter the
          container path here. Tremor will start watching it immediately — no restart required.
        </p>
        <p>
          If you don't have a local library yet, Phonolith works as an{' '}
          <strong className="text-zinc-400">analytics-only platform</strong> — connect Last.fm and
          Plex in Settings to populate the analytics dashboard.
        </p>
      </div>
    </div>
  )
}

export default function Sources() {
  const qc = useQueryClient()
  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
  })

  const deleteMut = useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['status'] })
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Library Sources</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Configure which directories Tremor watches for audio files. Changes take effect immediately.
        </p>
      </div>

      <DocNote />

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-800 py-10">
            <FolderOpen className="h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-600">No library sources configured</p>
          </div>
        ) : (
          sources.map(s => (
            <SourceCard
              key={s.id}
              source={s}
              onDelete={id => deleteMut.mutate(id)}
            />
          ))
        )}
      </div>

      <AddSourceForm onAdd={() => {}} />
    </div>
  )
}
