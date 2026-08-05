import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import AppHeader from '@/components/AppHeader'
import PlaybackBar from '@/components/PlaybackBar'
import { BrowserPlayerProvider } from '@/contexts/BrowserPlayerContext'
import { PageHeaderProvider } from '@/contexts/PageHeaderContext'

// Phonolith runs entirely in monospace at "pro-audio instrument panel"
// density — see docs/DESIGN_SYSTEM.md. This replaced Inter (sans) and
// Playfair Display (serif, formerly used only for the lyrics reader).
//
// Self-hosted (not next/font/google): that font's build-time fetch to
// fonts.googleapis.com/fonts.gstatic.com has no network path from the CI
// runner and fails the build. This is the same single variable-font file
// Google serves for every static weight in the latin subset (300-700), so
// one file + a weight range covers all of them, same as their own CSS does.
const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono-latin.woff2',
  variable: '--font-mono',
  weight: '300 700',
  style: 'normal',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Phonolith',
  description: 'The command centre for the music obsessive.',
}

// All setup/auth gating happens in middleware.ts, which has the real
// (unambiguous) pathname and asks /api/auth/session-status to do the
// Postgres-backed check. This layout is just the shared UI shell.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${jetbrainsMono.variable} font-mono text-sm`}>
        <BrowserPlayerProvider>
          <PageHeaderProvider>
            <Sidebar />
            {/* ml-56 clears the fixed desktop sidebar (w-56). AppHeader is
                position:sticky (not a nested overflow-y-auto scroll
                container) deliberately: several existing pages (e.g. /docs'
                IntersectionObserver-based TOC highlighting) assume the
                document itself is the scrolling element, and a nested scroll
                box would misalign that root. Sticky achieves the same
                "header stays visible" result without changing the scroll
                model any existing page relies on. */}
            <div className="md:ml-56">
              <AppHeader />
              <main className="pb-16">
                {children}
              </main>
            </div>
            <PlaybackBar />
          </PageHeaderProvider>
        </BrowserPlayerProvider>

        {/* Always-on CRT scanline texture + vignette — a mockup-wide effect
            (not a per-panel one) that sits above everything, pointer-events
            disabled so it never intercepts clicks. */}
        <div
          className="pointer-events-none fixed inset-0 z-[90] mix-blend-screen"
          style={{ background: 'repeating-linear-gradient(180deg, rgba(255,255,255,.028) 0 1px, rgba(0,0,0,0) 1px 3px)' }}
        />
        <div
          className="pointer-events-none fixed inset-0 z-[91]"
          style={{ background: 'radial-gradient(120% 110% at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,.42) 100%)' }}
        />
      </body>
    </html>
  )
}
