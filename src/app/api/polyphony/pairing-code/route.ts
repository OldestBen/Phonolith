import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { generatePairingCode } from '@/lib/polyphony'

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { code, expiresAt } = await generatePairingCode()
  return NextResponse.json({ code, expiresAt })
}
