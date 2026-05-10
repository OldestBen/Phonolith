import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Music2, Server, Disc3, Radio, Cloud, HardDrive,
  Plus, Trash2, Eye, EyeOff, RefreshCw, Check, Network,
  Thermometer, Clock, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react'
import {
  getConfig, updateConfig, triggerLastfmSync,
  getMounts, addMount, deleteMount,
  addSource,
  getSmartReports,
  type SmartReport, type NetworkMount,
} from '../lib/api'

// ─── helpers ────────────────────────────────────────────────────────────────

const INPUT = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-600 focus:outline-none'
const LABEL = 'text-[10px] text-zinc-500 uppercase tracking-widest'
const BTN_PRIMARY = 'flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40 transition-colors'
const BTN_SECONDARY = 'flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  )
}

function SavedBadge({ saved }: { saved: boolean }) {
  if (!saved) return null
  return (
    <span className="flex items-center gap-1 text-xs text-green-400">
      <Check className="w-3.5 h-3.5" /> Saved!
    </span>
  )
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(INPUT, 'pr-10')}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">{icon}</span>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// ─── SMART panel (preserved from original) ──────────────────────────────────

function fmtBytes(b?: number) {
  if (!b) return '—'
  const tb = b / 1e12
  return tb >= 1 ? `${tb.toFixed(1)} TB` : `${(b / 1e9).toFixed(0)} GB`
}

function SmartStatusIcon({ status }: { status: string }) {
  if (status === 'healthy') return <CheckCircle2 className="w-5 h-5 text-green-400" />
  if (status === 'warning') return <AlertTriangle className="w-5 h-5 text-yellow-400" />
  return <XCircle className="w-5 h-5 text-red-400" />
}

function DriveCard({ report }: { report: SmartReport }) {
  return (
    <div className={clsx(
      'bg-zinc-900 border rounded-xl p-4 flex flex-col gap-3',
      report.status === 'failed' ? 'border-red-800/60' :
      report.status === 'warning' ? 'border-yellow-800/60' : 'border-zinc-800',
    )}>
      <div className="flex items-center gap-3">
        <HardDrive className="w-5 h-5 text-zinc-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{report.model}</p>
          <p className="text-xs text-zinc-500 font-mono">{report.device}</p>
        </div>
        <SmartStatusIcon status={report.status} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Capacity</span>
          <span className="text-xs font-mono text-zinc-300">{fmtBytes(report.capacity_bytes)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-1">
            <Thermometer className="w-2.5 h-2.5" /> Temp
          </span>
          <span className={clsx('text-xs font-mono',
            report.temperature_c != null && report.temperature_c > 55 ? 'text-red-400' :
            report.temperature_c != null && report.temperature_c > 45 ? 'text-yellow-400' : 'text-zinc-300'
          )}>
            {report.temperature_c != null ? `${report.temperature_c}°C` : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Hours
          </span>
          <span className="text-xs font-mono text-zinc-300">
            {report.power_on_hours != null ? report.power_on_hours.toLocaleString() : '—'}
          </span>
        </div>
      </div>
      {report.critical_warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {report.critical_warnings.map(w => (
            <div key={w.attr_id} className="flex items-center gap-2 text-xs text-yellow-300 bg-yellow-900/20 rounded-lg px-3 py-1.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span>{w.attr_name}</span>
              <span className="font-mono ml-auto">{w.raw_value}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[9px] text-zinc-700 font-mono">
        Polled {new Date(report.polled_at).toLocaleString()}
      </p>
    </div>
  )
}

function SmartPanel() {
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['smart-reports'],
    queryFn: getSmartReports,
    staleTime: 60_000,
    refetchInterval: 300_000,
  })
  if (isLoading) return <p className="text-zinc-500 text-sm">Loading…</p>
  if (reports.length === 0) {
    return (
      <p className="text-zinc-600 text-xs">
        No S.M.A.R.T. data yet. The SMART service needs{' '}
        <code className="font-mono text-violet-400">smartmontools</code> and access to block devices
        (privileged container or CAP_SYS_RAWIO). Set{' '}
        <code className="font-mono text-violet-400">DEVICES=/dev/sda,/dev/sdb</code> in docker-compose.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {reports.map(r => <DriveCard key={r.device} report={r} />)}
    </div>
  )
}

// ─── Section: Last.fm ────────────────────────────────────────────────────────

function LastfmSection({ config }: { config: Record<string, string> }) {
  const qc = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [username, setUsername] = useState('')
  const [syncInterval, setSyncInterval] = useState('24')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config['lastfm.api_key'] !== undefined) setApiKey(config['lastfm.api_key'])
    if (config['lastfm.api_secret'] !== undefined) setApiSecret(config['lastfm.api_secret'])
    if (config['lastfm.username'] !== undefined) setUsername(config['lastfm.username'])
    if (config['lastfm.sync_interval_hours'] !== undefined) setSyncInterval(config['lastfm.sync_interval_hours'])
  }, [config])

  const saveMut = useMutation({
    mutationFn: () => updateConfig({
      'lastfm.api_key': apiKey,
      'lastfm.api_secret': apiSecret,
      'lastfm.username': username,
      'lastfm.sync_interval_hours': syncInterval,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const syncMut = useMutation({ mutationFn: triggerLastfmSync })

  const isConfigured = !!config['lastfm.api_key']

  return (
    <SectionCard icon={<Radio className="w-4 h-4" />} title="Last.fm">
      <div className="flex items-center gap-2">
        <span className={clsx('text-xs font-medium', isConfigured ? 'text-green-400' : 'text-zinc-500')}>
          {isConfigured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="API Key">
          <PasswordInput value={apiKey} onChange={setApiKey} placeholder="API key" />
        </Field>
        <Field label="API Secret">
          <PasswordInput value={apiSecret} onChange={setApiSecret} placeholder="API secret" />
        </Field>
        <Field label="Username">
          <input className={INPUT} value={username} onChange={e => setUsername(e.target.value)} placeholder="last.fm username" />
        </Field>
        <Field label="Sync Interval (hours)">
          <input className={INPUT} type="number" min={1} value={syncInterval} onChange={e => setSyncInterval(e.target.value)} placeholder="24" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Check className="w-4 h-4" /> Save
        </button>
        <button className={BTN_SECONDARY} onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
          <RefreshCw className={clsx('w-4 h-4', syncMut.isPending && 'animate-spin')} />
          Sync Now
        </button>
        <SavedBadge saved={saved} />
      </div>
    </SectionCard>
  )
}

// ─── Section: Plex ──────────────────────────────────────────────────────────

function PlexSection({ config }: { config: Record<string, string> }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [syncInterval, setSyncInterval] = useState('12')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config['plex.url'] !== undefined) setUrl(config['plex.url'])
    if (config['plex.token'] !== undefined) setToken(config['plex.token'])
    if (config['plex.sync_interval_hours'] !== undefined) setSyncInterval(config['plex.sync_interval_hours'])
  }, [config])

  const saveMut = useMutation({
    mutationFn: () => updateConfig({
      'plex.url': url,
      'plex.token': token,
      'plex.sync_interval_hours': syncInterval,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  return (
    <SectionCard icon={<Server className="w-4 h-4" />} title="Plex">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Plex URL">
          <input className={INPUT} value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:32400" />
        </Field>
        <Field label="Token">
          <PasswordInput value={token} onChange={setToken} placeholder="Plex auth token" />
        </Field>
        <Field label="Sync Interval (hours)">
          <input className={INPUT} type="number" min={1} value={syncInterval} onChange={e => setSyncInterval(e.target.value)} placeholder="12" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Check className="w-4 h-4" /> Save
        </button>
        <SavedBadge saved={saved} />
      </div>
    </SectionCard>
  )
}

// ─── Section: Discogs ────────────────────────────────────────────────────────

function DiscogsSection({ config }: { config: Record<string, string> }) {
  const qc = useQueryClient()
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config['discogs.token'] !== undefined) setToken(config['discogs.token'])
  }, [config])

  const saveMut = useMutation({
    mutationFn: () => updateConfig({ 'discogs.token': token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  return (
    <SectionCard icon={<Disc3 className="w-4 h-4" />} title="Discogs">
      <Field label="Personal Access Token">
        <PasswordInput value={token} onChange={setToken} placeholder="Discogs token" />
      </Field>
      <div className="flex items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Check className="w-4 h-4" /> Save
        </button>
        <SavedBadge saved={saved} />
      </div>
    </SectionCard>
  )
}

// ─── Section: MusicBrainz ────────────────────────────────────────────────────

function MusicBrainzSection({ config }: { config: Record<string, string> }) {
  const qc = useQueryClient()
  const [userAgent, setUserAgent] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config['musicbrainz.user_agent'] !== undefined) setUserAgent(config['musicbrainz.user_agent'])
  }, [config])

  const saveMut = useMutation({
    mutationFn: () => updateConfig({ 'musicbrainz.user_agent': userAgent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  return (
    <SectionCard icon={<Music2 className="w-4 h-4" />} title="MusicBrainz">
      <Field label="User Agent (email)">
        <input className={INPUT} value={userAgent} onChange={e => setUserAgent(e.target.value)} placeholder="you@example.com" />
      </Field>
      <div className="flex items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Check className="w-4 h-4" /> Save
        </button>
        <SavedBadge saved={saved} />
      </div>
    </SectionCard>
  )
}

// ─── Section: Network Shares ─────────────────────────────────────────────────

function MountRow({ mount, onDelete }: { mount: NetworkMount; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2">
      <Network className="w-4 h-4 text-zinc-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate">{mount.host}/{mount.share}</p>
        <p className="text-xs text-zinc-500 font-mono truncate">{mount.mount_point}</p>
      </div>
      <span className={clsx(
        'text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full',
        mount.alive === true ? 'bg-green-900/40 text-green-400' :
        mount.alive === false ? 'bg-red-900/40 text-red-400' : 'bg-zinc-800 text-zinc-500'
      )}>
        {mount.protocol}
      </span>
      <button onClick={onDelete} className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

function NetworkSharesSection() {
  const qc = useQueryClient()
  const { data: mounts = [] } = useQuery({ queryKey: ['mounts'], queryFn: getMounts })

  const [protocol, setProtocol] = useState<'smb' | 'nfs'>('smb')
  const [host, setHost] = useState('')
  const [share, setShare] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mounts'] }),
  })

  const addMut = useMutation({
    mutationFn: () => addMount({
      protocol,
      host,
      share,
      ...(protocol === 'smb' && username ? { username } : {}),
      ...(protocol === 'smb' && password ? { password } : {}),
    }),
    onSuccess: async (result) => {
      await addSource(`${host}/${share}`, result.mount_point)
      qc.invalidateQueries({ queryKey: ['mounts'] })
      qc.invalidateQueries({ queryKey: ['sources'] })
      setHost('')
      setShare('')
      setUsername('')
      setPassword('')
      setError('')
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <SectionCard icon={<Network className="w-4 h-4" />} title="Network Shares">
      {mounts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {mounts.map(m => (
            <MountRow key={m.id} mount={m} onDelete={() => deleteMut.mutate(m.id)} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-600">No network shares configured.</p>
      )}

      <div className="border-t border-zinc-800 pt-4 flex flex-col gap-3">
        <p className={LABEL}>Add New Share</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Protocol">
            <select
              className={INPUT}
              value={protocol}
              onChange={e => setProtocol(e.target.value as 'smb' | 'nfs')}
            >
              <option value="smb">SMB</option>
              <option value="nfs">NFS</option>
            </select>
          </Field>
          <Field label="Host">
            <input className={INPUT} value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
          </Field>
          <Field label="Share Name">
            <input className={INPUT} value={share} onChange={e => setShare(e.target.value)} placeholder="music" />
          </Field>
          {protocol === 'smb' && (
            <>
              <Field label="Username">
                <input className={INPUT} value={username} onChange={e => setUsername(e.target.value)} placeholder="optional" />
              </Field>
              <Field label="Password">
                <PasswordInput value={password} onChange={setPassword} placeholder="optional" />
              </Field>
            </>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div>
          <button
            className={BTN_PRIMARY}
            onClick={() => addMut.mutate()}
            disabled={addMut.isPending || !host || !share}
          >
            <Plus className="w-4 h-4" />
            {addMut.isPending ? 'Mounting…' : 'Add Share'}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── Section: S3 / Vault ─────────────────────────────────────────────────────

function S3Section({ config }: { config: Record<string, string> }) {
  const qc = useQueryClient()
  const [endpoint, setEndpoint] = useState('')
  const [bucket, setBucket] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [region, setRegion] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config['s3.endpoint'] !== undefined) setEndpoint(config['s3.endpoint'])
    if (config['s3.bucket'] !== undefined) setBucket(config['s3.bucket'])
    if (config['s3.access_key'] !== undefined) setAccessKey(config['s3.access_key'])
    if (config['s3.secret_key'] !== undefined) setSecretKey(config['s3.secret_key'])
    if (config['s3.region'] !== undefined) setRegion(config['s3.region'])
  }, [config])

  const saveMut = useMutation({
    mutationFn: () => updateConfig({
      's3.endpoint': endpoint,
      's3.bucket': bucket,
      's3.access_key': accessKey,
      's3.secret_key': secretKey,
      's3.region': region,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  return (
    <SectionCard icon={<Cloud className="w-4 h-4" />} title="S3 / Vault">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Endpoint URL">
          <input className={INPUT} value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://s3.amazonaws.com" />
        </Field>
        <Field label="Bucket">
          <input className={INPUT} value={bucket} onChange={e => setBucket(e.target.value)} placeholder="my-music-vault" />
        </Field>
        <Field label="Access Key">
          <input className={INPUT} value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder="AKIAIOSFODNN7EXAMPLE" />
        </Field>
        <Field label="Secret Key">
          <PasswordInput value={secretKey} onChange={setSecretKey} placeholder="secret access key" />
        </Field>
        <Field label="Region">
          <input className={INPUT} value={region} onChange={e => setRegion(e.target.value)} placeholder="us-east-1" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Check className="w-4 h-4" /> Save
        </button>
        <SavedBadge saved={saved} />
      </div>
    </SectionCard>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { data: config = {} } = useQuery({ queryKey: ['config'], queryFn: getConfig })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
        <p className="text-xs text-zinc-500 mt-1">Service configuration, integrations, and health monitoring.</p>
      </div>

      <LastfmSection config={config} />
      <PlexSection config={config} />
      <DiscogsSection config={config} />
      <MusicBrainzSection config={config} />
      <NetworkSharesSection />
      <S3Section config={config} />

      {/* Drive Health (S.M.A.R.T.) */}
      <SectionCard icon={<HardDrive className="w-4 h-4" />} title="Drive Health (S.M.A.R.T.)">
        <p className="text-xs text-zinc-600">
          Polled by the SMART service every hour. Alerts publish to{' '}
          <code className="font-mono text-violet-400">phonolith.health.alert</code> when reallocated
          sectors or media errors are detected.
        </p>
        <SmartPanel />
      </SectionCard>
    </div>
  )
}
