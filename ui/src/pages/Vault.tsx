import { Shield } from 'lucide-react'

export default function Vault() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <Shield className="w-12 h-12 text-zinc-700" />
      <h2 className="text-lg font-semibold text-zinc-300">Aegis Vault — Coming Soon</h2>
      <p className="text-zinc-500 max-w-sm text-sm">
        Aegis will surface your S3 backup status, vault health reports, chunk manifests,
        and SurePlay verification results here.
      </p>
    </div>
  )
}
