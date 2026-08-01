import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import AppHeader from '@/components/AppHeader'
import PlaybackBar from '@/components/PlaybackBar'
import { BrowserPlayerProvider } from '@/contexts/BrowserPlayerContext'
import { PageHeaderProvider } from '@/contexts/PageHeaderContext'

// Phonolith runs entirely in monospace at "pro-audio instrument panel"
// density — see docs/DESIGN_SYSTEM.md. This replaced Inter (sans) and
// Playfair Display (serif, formerly used only for the lyrics reader).
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
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
      </body>
    </html>
  )
}
