'use client'

import { useRouter } from 'next/navigation'
import type { Credit } from '@/lib/types'

interface CreditsTableProps {
  credits: Credit[]
  primaryArtist?: string
}

export default function CreditsTable({ credits, primaryArtist }: CreditsTableProps) {
  const router = useRouter()

  const grouped: Record<string, string[]> = {}
  for (const c of credits) {
    if (!grouped[c.role]) grouped[c.role] = []
    grouped[c.role].push(c.name)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="text-left px-4 py-2 text-xs text-text-muted font-medium uppercase tracking-wider">Role</th>
            <th className="text-left px-4 py-2 text-xs text-text-muted font-medium uppercase tracking-wider">Name</th>
          </tr>
        </thead>
        <tbody>
          {primaryArtist && (
            <tr className="border-b border-border hover:bg-surface-2 transition-colors">
              <td className="px-4 py-3 text-sm text-text-muted">Primary Artist</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => router.push(`/?q=${encodeURIComponent(primaryArtist)}`)}
                  className="text-sm text-text-primary hover:text-accent transition-colors"
                >
                  {primaryArtist}
                </button>
              </td>
            </tr>
          )}
          {Object.entries(grouped).map(([role, names]) => (
            <tr key={role} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
              <td className="px-4 py-3 text-sm text-text-muted align-top">{role}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {names.map(name => (
                    <button
                      key={name}
                      onClick={() => router.push(`/?q=${encodeURIComponent(name)}`)}
                      className="text-sm text-text-primary hover:text-accent transition-colors"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!primaryArtist && Object.keys(grouped).length === 0 && (
        <div className="px-4 py-8 text-center text-text-muted text-sm">No credits available</div>
      )}
    </div>
  )
}
