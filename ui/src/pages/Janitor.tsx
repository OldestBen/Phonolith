import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getJanitorSilentTracks, getJanitorArtworkAudit, getJanitorMissingDisc,
  type SilentTrack, type ArtworkIssue, type DiscIssue,
} from '../lib/api'
import { VolumeX, Image, Disc, AlertTriangle, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'

type Tab = 'silent' | 'artwork' | 'disc'

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'silent',  label: 'Silent Tracks',    icon: VolumeX },
  { id: 'artwork', label: 'Artwork Audit',     icon: Image },
  { id: 'disc',    label: 'Missing Disc Tags', icon: Disc },
]

function SectionHeader({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {count === 0
        ? <CheckCircle2 className="w-4 h-4 text-green-500" />
        : <AlertTriangle className="w-4 h-4 text-yellow-400" />}
      <span className="text-sm text-zinc-300">
        {count === 0 ? `No ${label} found` : `${count} ${label}`}
      </span>
    </div>
  )
}

function fmt(v: number | undefined, decimals = 1) {
  if (v == null) return '—'
  return v.toFixed(decimals)
}

// ── Silent tracks ────────────────────────────────────────────────────────────

function SilentPanel() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['janitor-silent'],
    queryFn: () => getJanitorSilentTracks(),
    staleTime: 60_000,
  })

  if (isLoading) return <p className="text-zinc-500 text-sm py-8 text-center">Scanning…</p>

  return (
    <div>
      <p className="text-xs text-zinc-500 mb-4">
        Tracks where measured peak level is below −50 dBFS or RMS below −60 dBFS — likely silent
        filler, miscoded live intros, or corrupt encodes.
      </p>
      <SectionHeader count={data.length} label="potentially silent tracks" />
      {data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="px-3 py-2 text-left font-medium">Title</th>
                <th className="px-3 py-2 text-left font-medium">Artist</th>
                <th className="px-3 py-2 text-left font-medium">Album</th>
                <th className="px-3 py-2 text-left font-medium">Format</th>
                <th className="px-3 py-2 text-right font-medium">Peak dBFS</th>
                <th className="px-3 py-2 text-right font-medium">RMS dBFS</th>
                <th className="px-3 py-2 text-right font-medium">DR</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t: SilentTrack) => (
                <tr key={t.hash} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-3 py-2 text-zinc-200 truncate max-w-[180px]">{t.title ?? t.filename}</td>
                  <td className="px-3 py-2 text-zinc-400 truncate max-w-[140px]">{t.artist ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-500 truncate max-w-[140px]">{t.album ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[10px] text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded">
                      {t.format ?? '?'}
                    </span>
                  </td>
                  <td className={clsx(
                    'px-3 py-2 text-right font-mono text-xs',
                    t.peak_level != null && t.peak_level < -60 ? 'text-red-400' : 'text-yellow-400'
                  )}>
                    {fmt(t.peak_level)}
                  </td>
                  <td className={clsx(
                    'px-3 py-2 text-right font-mono text-xs',
                    t.rms_level != null && t.rms_level < -70 ? 'text-red-400' : 'text-yellow-400'
                  )}>
                    {fmt(t.rms_level)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
                    {t.dr_score != null ? `DR${t.dr_score}` : '—'}
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

// ── Artwork audit ────────────────────────────────────────────────────────────

function ArtworkPanel() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['janitor-artwork'],
    queryFn: () => getJanitorArtworkAudit(),
    staleTime: 60_000,
  })

  if (isLoading) return <p className="text-zinc-500 text-sm py-8 text-center">Scanning…</p>

  const missing = data.filter(a => a.issue === 'missing')
  const lowRes  = data.filter(a => a.issue === 'low_res')

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-zinc-500">
        Albums without embedded artwork or with artwork smaller than 500 × 500 px. Fix with a
        tag editor or a metadata fetcher like beets/MusicBrainz Picard.
      </p>

      {/* Missing */}
      <div>
        <SectionHeader count={missing.length} label="albums missing artwork" />
        {missing.length > 0 && <ArtworkTable rows={missing} />}
      </div>

      {/* Low-res */}
      <div>
        <SectionHeader count={lowRes.length} label="albums with low-res artwork (&lt; 500 px)" />
        {lowRes.length > 0 && <ArtworkTable rows={lowRes} />}
      </div>
    </div>
  )
}

function ArtworkTable({ rows }: { rows: ArtworkIssue[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
            <th className="px-3 py-2 text-left font-medium">Album</th>
            <th className="px-3 py-2 text-left font-medium">Artist</th>
            <th className="px-3 py-2 text-right font-medium">Tracks</th>
            <th className="px-3 py-2 text-right font-medium">Dimensions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a: ArtworkIssue) => (
            <tr key={a.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
              <td className="px-3 py-2 text-zinc-200 truncate max-w-[200px]">{a.album}</td>
              <td className="px-3 py-2 text-zinc-400 truncate max-w-[160px]">{a.artist ?? '—'}</td>
              <td className="px-3 py-2 text-right text-zinc-500 text-xs">{a.track_count}</td>
              <td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
                {a.artwork_width && a.artwork_height
                  ? <span className="text-yellow-400">{a.artwork_width} × {a.artwork_height}</span>
                  : <span className="text-red-400">none</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Missing disc tags ────────────────────────────────────────────────────────

function DiscPanel() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['janitor-disc'],
    queryFn: () => getJanitorMissingDisc(),
    staleTime: 60_000,
  })

  if (isLoading) return <p className="text-zinc-500 text-sm py-8 text-center">Scanning…</p>

  const noTags      = data.filter(d => d.tagged_disc_count === 0)
  const inconsistent = data.filter(d => d.tagged_disc_count > 0 && d.untagged_disc_count > 0)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-zinc-500">
        Multi-disc albums detected by high track numbers or inconsistent disc_number tags.
        Without correct disc tags, players may mis-order tracks or merge discs incorrectly.
      </p>

      <div>
        <SectionHeader count={noTags.length} label="albums likely multi-disc but untagged" />
        {noTags.length > 0 && <DiscTable rows={noTags} />}
      </div>

      <div>
        <SectionHeader count={inconsistent.length} label="albums with inconsistent disc tagging" />
        {inconsistent.length > 0 && <DiscTable rows={inconsistent} />}
      </div>
    </div>
  )
}

function DiscTable({ rows }: { rows: DiscIssue[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-600 text-xs uppercase tracking-wider border-b border-zinc-800">
            <th className="px-3 py-2 text-left font-medium">Album</th>
            <th className="px-3 py-2 text-left font-medium">Artist</th>
            <th className="px-3 py-2 text-right font-medium">Tracks</th>
            <th className="px-3 py-2 text-right font-medium">Max #</th>
            <th className="px-3 py-2 text-right font-medium">Tagged</th>
            <th className="px-3 py-2 text-right font-medium">Untagged</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d: DiscIssue, i: number) => (
            <tr key={`${d.album}-${i}`} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
              <td className="px-3 py-2 text-zinc-200 truncate max-w-[200px]">{d.album}</td>
              <td className="px-3 py-2 text-zinc-400 truncate max-w-[160px]">{d.artist ?? '—'}</td>
              <td className="px-3 py-2 text-right text-zinc-400 text-xs font-mono">{d.track_count}</td>
              <td className="px-3 py-2 text-right text-zinc-500 text-xs font-mono">
                {d.max_track_number ?? '—'}
              </td>
              <td className="px-3 py-2 text-right text-xs font-mono">
                <span className={d.tagged_disc_count > 0 ? 'text-green-400' : 'text-zinc-600'}>
                  {d.tagged_disc_count}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-xs font-mono">
                <span className={d.untagged_disc_count > 0 ? 'text-yellow-400' : 'text-zinc-600'}>
                  {d.untagged_disc_count}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Janitor() {
  const [tab, setTab] = useState<Tab>('silent')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Data Janitor</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Library health scanners — identify silent tracks, missing artwork, and malformed disc tags.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
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

      {/* Content */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        {tab === 'silent'  && <SilentPanel />}
        {tab === 'artwork' && <ArtworkPanel />}
        {tab === 'disc'    && <DiscPanel />}
      </div>
    </div>
  )
}
