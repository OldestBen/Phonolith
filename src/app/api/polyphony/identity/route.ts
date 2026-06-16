import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { getOwnPeerId, getOwnName, isPublicDiscoveryEnabled } from '@/lib/polyphony'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  return NextResponse.json({
    peerId: await getOwnPeerId(),
    name: await getOwnName(),
    publicDiscoveryEnabled: await isPublicDiscoveryEnabled(),
  })
}
