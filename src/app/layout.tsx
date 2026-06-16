import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import Notifications from '@/components/Notifications'
import PlaybackBar from '@/components/PlaybackBar'
import { BrowserPlayerProvider } from '@/contexts/BrowserPlayerContext'
import { getUserFromSessionCookie, hasAnyUsers, SESSION_COOKIE_NAME } from '@/lib/auth'

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

// Routes that don't require an authenticated session (must match the
// PUBLIC_PATH_PREFIXES / PUBLIC_PAGES lists in middleware.ts).
const PUBLIC_PATH_PREFIXES = ['/_next', '/favicon.ico', '/api/auth/']
const PUBLIC_PAGES = ['/setup', '/login']

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  return PUBLIC_PAGES.includes(pathname)
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // middleware.ts only checks for the *presence* of a session cookie
  // (Edge runtime can't use postgres.js or full Node crypto reliably in
  // this Next.js version). This layout runs on the Node.js runtime, so it
  // does the real work: verifying the signed session against the database,
  // and redirecting to /setup on first boot when no users exist yet.
  const headerList = headers()
  const pathname = headerList.get('x-phonolith-pathname') ?? '/'

  if (!isPublicPath(pathname)) {
    const usersExist = await hasAnyUsers()
    if (!usersExist) {
      redirect('/setup')
    }

    const cookieValue = cookies().get(SESSION_COOKIE_NAME)?.value
    const user = await getUserFromSessionCookie(cookieValue)
    if (!user) {
      redirect('/login')
    }
  }

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
