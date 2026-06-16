export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getStatus } from '@/lib/analyst'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const status = await getStatus()
  if (!status) {
    return NextResponse.json({ files_indexed: 0, last_scan: null, watching: false, online: false })
  }
  return NextResponse.json({ ...status, online: true })
}
