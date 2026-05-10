import { useQuery } from '@tanstack/react-query'
import { getSmartReports, type SmartReport } from '../lib/api'
import { Settings as SettingsIcon, HardDrive, Thermometer, Clock, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import clsx from 'clsx'

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
    refetchInterval: 300_000,  // re-poll every 5 min
  })

  if (isLoading) return <p className="text-zinc-500 text-sm">Loading…</p>

  if (reports.length === 0) {
    return (
      <p className="text-zinc-600 text-xs">
        No S.M.A.R.T. data yet. The SMART service needs <code className="font-mono text-violet-400">smartmontools</code> and
        access to block devices (privileged container or CAP_SYS_RAWIO). Set <code className="font-mono text-violet-400">DEVICES=/dev/sda,/dev/sdb</code> in docker-compose.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {reports.map(r => <DriveCard key={r.device} report={r} />)}
    </div>
  )
}

export default function Settings() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
        <p className="text-xs text-zinc-500 mt-1">System configuration and health monitoring.</p>
      </div>

      {/* SMART health */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 mb-1">Drive Health (S.M.A.R.T.)</h2>
        <p className="text-xs text-zinc-600 mb-4">
          Polled by the SMART service every hour. Alerts publish to phonolith.health.alert when
          reallocated sectors or media errors are detected.
        </p>
        <SmartPanel />
      </div>

      {/* Config placeholder */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <SettingsIcon className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-400">Configuration</h2>
        </div>
        <p className="text-zinc-600 text-xs max-w-md">
          API keys (Last.fm, Discogs, MusicBrainz), S3 credentials, library paths,
          worker pool sizes, and AccurateRip verification preferences are configured
          via environment variables in docker-compose.yml.
        </p>
      </div>
    </div>
  )
}
