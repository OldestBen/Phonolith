'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/auth/setup')
      .then(r => r.json())
      .then(data => { if (data.needsSetup) router.replace('/setup') })
      .catch(() => {})
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Invalid username or password.')
        setSubmitting(false)
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setError('Invalid username or password.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-accent font-bold text-base">P</span>
          </div>
          <h1 className="text-text-primary text-lg font-semibold">Sign in to Phonolith</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-6 flex flex-col gap-4">
          <div>
            <label className="text-text-muted text-xs uppercase tracking-widest">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="mt-1 bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label className="text-text-muted text-xs uppercase tracking-widest">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 bg-background border border-border text-text-primary text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-40 shrink-0"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
