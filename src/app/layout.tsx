import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import Notifications from '@/components/Notifications'
import PlaybackBar from '@/components/PlaybackBar'
import { BrowserPlayerProvider } from '@/contexts/BrowserPlayerContext'

const inter = Inter({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  style: ['normal', 'italic'],
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
      <body className={`${inter.variable} ${playfair.variable} font-sans`}>
        <BrowserPlayerProvider>
          <Sidebar />
          <Notifications />
          <main className="ml-16 pb-16">
            {children}
          </main>
          <PlaybackBar />
        </BrowserPlayerProvider>
      </body>
    </html>
  )
}
