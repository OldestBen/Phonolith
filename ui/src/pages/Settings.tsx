import { Settings as SettingsIcon } from 'lucide-react'

export default function Settings() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <SettingsIcon className="w-12 h-12 text-zinc-700" />
      <h2 className="text-lg font-semibold text-zinc-300">Settings — Coming Soon</h2>
      <p className="text-zinc-500 max-w-sm text-sm">
        Configure your library paths, API keys (Last.fm, Discogs, MusicBrainz),
        S3 credentials, worker pool size, and AirPlay zones here.
      </p>
    </div>
  )
}
