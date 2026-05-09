import { Cpu } from 'lucide-react'

export default function Hardware() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <Cpu className="w-12 h-12 text-zinc-700" />
      <h2 className="text-lg font-semibold text-zinc-300">Cathode — Coming Soon</h2>
      <p className="text-zinc-500 max-w-sm text-sm">
        Cathode will track your DACs, headphone amps, and vacuum tubes here —
        including burn-in hours per endpoint and hardware-correlated listening stats.
      </p>
    </div>
  )
}
