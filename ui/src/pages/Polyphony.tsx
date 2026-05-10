import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPendingFixes, getPeers, decideFix, publishFix, getBountyList, addBountyItem,
  removeBountyItem, getTracks,
  type PendingFix, type PeerNode, type BountyItem,
} from '../lib/api'
import {
  Network, CheckCircle, XCircle, Clock, ShieldCheck, ShieldAlert,
  Users, Tag, Send, ShoppingCart, Trash2, Plus,
} from 'lucide-react'
import clsx from 'clsx'

type Tab = 'fixes' | 'propose' | 'peers' | 'bounty'

const STATUS_TABS: { id: 'pending' | 'approved' | 'rejected'; label: string }[] = [
  { id: 'pending',  label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

const ALLOWED_FIELDS = [
  'title', 'artist', 'album', 'album_artist', 'year', 'genre', 'label',
  'composer', 'lyricist', 'engineer', 'mixer', 'mastered_by', 'remixed_by',
  'bpm', 'initial_key', 'track_number', 'disc_number',
]

function FieldBadge({ field }: { field: string }) {
  return (
    <span className="font-mono text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
      {field}
    </span>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'approved') return <CheckCircle className="w-4 h-4 text-green-400" />
  if (status === 'rejected') return <XCircle className="w-4 h-4 text-red-400" />
  return <Clock className="w-4 h-4 text-yellow-400" />
}

function FixCard({ fix, onDecide }: { fix: PendingFix; onDecide: (id: string, action: 'approve' | 'reject') => void }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusIcon status={fix.status} />
            <span className="text-sm font-medium text-zinc-200 truncate">
              {fix.track_title ?? fix.blake3_hash.slice(0, 16) + '…'}
            </span>
            {fix.track_artist && (
              <span className="text-xs text-zinc-500 truncate">by {fix.track_artist}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500">from</span>
            <span className="text-xs text-violet-400 font-medium">{fix.peer_alias}</span>
            <span className="text-xs text-zinc-600">·</span>
            <FieldBadge field={fix.field} />
          </div>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono flex-shrink-0">
          {new Date(fix.received_at).toLocaleString()}
        </span>
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-hidden text-xs font-mono">
        {fix.old_value != null && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-950/20 border-b border-zinc-800">
            <span className="text-red-400 select-none">−</span>
            <span className="text-red-300 break-all">{fix.old_value}</span>
          </div>
        )}
        <div className="flex items-start gap-2 px-3 py-2 bg-green-950/20">
          <span className="text-green-400 select-none">+</span>
          <span className="text-green-300 break-all">{fix.new_value}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <ShieldCheck className="w-3 h-3 text-green-500" />
        <span>Ed25519 signature verified</span>
        <span className="text-zinc-700 mx-1">·</span>
        <span className="font-mono text-zinc-700 truncate max-w-[200px]">{fix.blake3_hash}</span>
      </div>

      {fix.status === 'pending' && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onDecide(fix.id, 'approve')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-800/40 hover:bg-green-700/50 text-green-300 text-xs font-medium transition-colors border border-green-800/50"
          >
            <CheckCircle className="w-3.5 h-3.5" /> Apply fix
          </button>
          <button
            onClick={() => onDecide(fix.id, 'reject')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
        </div>
      )}
    </div>
  )
}

function FixesPanel() {
  const [statusTab, setStatusTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const qc = useQueryClient()

  const { data: fixes = [], isLoading } = useQuery({
    queryKey: ['polyphony-fixes', statusTab],
    queryFn: () => getPendingFixes(statusTab),
    staleTime: 10_000,
    refetchInterval: statusTab === 'pending' ? 15_000 : false,
  })

  const { mutate: decide } = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      decideFix(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['polyphony-fixes'] }),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        {STATUS_TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setStatusTab(id)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              statusTab === id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : fixes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          {statusTab === 'pending'
            ? <><ShieldCheck className="w-10 h-10 text-zinc-700" /><p className="text-zinc-500 text-sm">No pending peer fixes — your tags are in sync.</p></>
            : <p className="text-zinc-600 text-sm">No {statusTab} fixes.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {fixes.map(fix => (
            <FixCard key={fix.id} fix={fix} onDecide={(id, action) => decide({ id, action })} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProposePanel() {
  const [hash, setHash] = useState('')
  const [trackSearch, setTrackSearch] = useState('')
  const [field, setField] = useState('title')
  const [newValue, setNewValue] = useState('')
  const [oldValue, setOldValue] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  const { data: results } = useQuery({
    queryKey: ['track-search-propose', trackSearch],
    queryFn: () => getTracks({ search: trackSearch, per_page: 8 }),
    enabled: trackSearch.length > 2,
    staleTime: 10_000,
  })

  const { mutate: publish, isPending } = useMutation({
    mutationFn: () => publishFix(hash, field, newValue, oldValue || undefined),
    onSuccess: () => { setSent(true); setNewValue(''); setOldValue('') },
    onError: (e: Error) => setErr(e.message),
  })

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <ShieldCheck className="w-10 h-10 text-green-600" />
        <p className="text-zinc-300 text-sm font-medium">Fix proposal signed and broadcast to peers.</p>
        <button onClick={() => setSent(false)} className="text-xs text-violet-400 hover:underline">
          Propose another
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 max-w-lg">
      <p className="text-xs text-zinc-500">
        Select a track, choose the metadata field to correct, then enter the accurate value.
        Polyphony signs the fix with your Ed25519 key and broadcasts it to connected peers.
      </p>

      {/* Track picker */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-zinc-400 font-medium">Track</label>
        <input
          type="text"
          placeholder="Search by title or artist…"
          value={trackSearch}
          onChange={e => setTrackSearch(e.target.value)}
          className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
        />
        {results && results.tracks.length > 0 && trackSearch.length > 2 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800 max-h-48 overflow-y-auto">
            {results.tracks.map(t => (
              <button
                key={t.hash}
                onClick={() => { setHash(t.hash); setTrackSearch(`${t.artist ?? ''} — ${t.title ?? t.hash.slice(0, 12)}`) }}
                className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <span className="font-medium">{t.title ?? '(untitled)'}</span>
                {t.artist && <span className="text-zinc-500 ml-2">{t.artist}</span>}
                <span className="float-right font-mono text-zinc-700">{t.hash.slice(0, 10)}…</span>
              </button>
            ))}
          </div>
        )}
        {hash && (
          <p className="text-[10px] font-mono text-violet-500">Selected: {hash.slice(0, 24)}…</p>
        )}
      </div>

      {/* Field picker */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-zinc-400 font-medium">Field to correct</label>
        <select
          value={field}
          onChange={e => setField(e.target.value)}
          className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-600"
        >
          {ALLOWED_FIELDS.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Old value */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-zinc-400 font-medium">Current (wrong) value <span className="text-zinc-600">(optional)</span></label>
        <input
          type="text"
          value={oldValue}
          onChange={e => setOldValue(e.target.value)}
          className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
          placeholder="Leave blank if unknown"
        />
      </div>

      {/* New value */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-zinc-400 font-medium">Correct value</label>
        <input
          type="text"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
          placeholder={`Correct ${field}…`}
        />
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      <button
        onClick={() => publish()}
        disabled={!hash || !newValue || isPending}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-sm font-medium transition-colors w-fit"
      >
        <Send className="w-4 h-4" />
        {isPending ? 'Broadcasting…' : 'Sign & broadcast fix'}
      </button>
    </div>
  )
}

function BountyPanel() {
  const qc = useQueryClient()
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [year, setYear] = useState('')
  const [notes, setNotes] = useState('')
  const [showForm, setShowForm] = useState(false)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['bounty-list'],
    queryFn: getBountyList,
    staleTime: 30_000,
  })

  const { mutate: add, isPending: isAdding } = useMutation({
    mutationFn: () => addBountyItem(artist, album, year ? parseInt(year) : undefined, notes || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bounty-list'] })
      setArtist(''); setAlbum(''); setYear(''); setNotes(''); setShowForm(false)
    },
  })

  const { mutate: remove } = useMutation({
    mutationFn: removeBountyItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bounty-list'] }),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Albums you're hunting for. Visible to trusted Polyphony peers so they can flag matches in their libraries.
        </p>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Artist</label>
              <input
                value={artist}
                onChange={e => setArtist(e.target.value)}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
                placeholder="Artist name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Album</label>
              <input
                value={album}
                onChange={e => setAlbum(e.target.value)}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
                placeholder="Album title"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Year <span className="text-zinc-700">(opt)</span></label>
              <input
                value={year}
                onChange={e => setYear(e.target.value)}
                type="number"
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
                placeholder="1973"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Notes <span className="text-zinc-700">(opt)</span></label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
                placeholder="e.g. Original press only"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => add()}
              disabled={!artist || !album || isAdding}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add to bounty list
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <ShoppingCart className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-500 text-sm">No wanted albums yet. Start adding albums you're hunting for.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="px-4 py-2 text-left font-medium">Artist</th>
                <th className="px-4 py-2 text-left font-medium">Album</th>
                <th className="px-4 py-2 text-left font-medium">Year</th>
                <th className="px-4 py-2 text-left font-medium">Notes</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item: BountyItem) => (
                <tr key={item.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-4 py-3 text-zinc-200 font-medium">{item.artist}</td>
                  <td className="px-4 py-3 text-zinc-300">{item.album}</td>
                  <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{item.year ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{item.notes ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(item.id)}
                      className="text-zinc-700 hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PeersPanel() {
  const { data: peers = [], isLoading } = useQuery({
    queryKey: ['polyphony-peers'],
    queryFn: getPeers,
    staleTime: 30_000,
  })

  if (isLoading) return <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>

  if (peers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Network className="w-10 h-10 text-zinc-700" />
        <p className="text-zinc-500 text-sm max-w-xs">
          No peers registered yet. Connect a peer node via WireGuard and run the Polyphony handshake.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
            <th className="px-4 py-2 text-left font-medium">Alias</th>
            <th className="px-4 py-2 text-left font-medium">Endpoint</th>
            <th className="px-4 py-2 text-left font-medium">Last seen</th>
            <th className="px-4 py-2 text-right font-medium">Shared tracks</th>
            <th className="px-4 py-2 text-center font-medium">Trusted</th>
          </tr>
        </thead>
        <tbody>
          {peers.map((p: PeerNode) => (
            <tr key={p.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
              <td className="px-4 py-3 text-zinc-200 font-medium">{p.alias}</td>
              <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{p.wireguard_endpoint ?? '—'}</td>
              <td className="px-4 py-3 text-zinc-500 text-xs">
                {p.last_seen_at ? new Date(p.last_seen_at).toLocaleString() : 'never'}
              </td>
              <td className="px-4 py-3 text-right text-zinc-400 font-mono text-xs">
                {p.shared_track_count.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-center">
                {p.is_trusted
                  ? <ShieldCheck className="w-4 h-4 text-green-400 mx-auto" />
                  : <ShieldAlert className="w-4 h-4 text-zinc-600 mx-auto" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Polyphony() {
  const [tab, setTab] = useState<Tab>('fixes')

  const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'fixes',   label: 'Fix Proposals', icon: Tag },
    { id: 'propose', label: 'Propose Fix',   icon: Send },
    { id: 'bounty',  label: 'Bounty List',   icon: ShoppingCart },
    { id: 'peers',   label: 'Peer Nodes',    icon: Users },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Polyphony</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Peer-to-peer signed metadata overlay. Propose corrections, browse inbound peer fixes,
          track wanted albums, and manage trusted nodes.
        </p>
      </div>

      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === id
                ? 'bg-violet-700 text-white'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'fixes'   && <FixesPanel />}
        {tab === 'propose' && <ProposePanel />}
        {tab === 'bounty'  && <BountyPanel />}
        {tab === 'peers'   && <PeersPanel />}
      </div>
    </div>
  )
}
