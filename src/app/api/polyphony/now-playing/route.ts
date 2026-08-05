import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { rset } from '@/lib/redis'
import { NOW_PLAYING_KEY, NOW_PLAYING_TTL_SECONDS } from '@/lib/polyphony'

/** Internal beacon: the client tells us what's currently playing so trusted peers can see it. */
export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: { title?: string; artist?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.title) {
    await rset(NOW_PLAYING_KEY, null, NOW_PLAYING_TTL_SECONDS)
    return NextResponse.json({ status: 'cleared' })
  }

  await rset(NOW_PLAYING_KEY, {
    title: body.title,
    artist: body.artist ?? null,
    updatedAt: new Date().toISOString(),
  }, NOW_PLAYING_TTL_SECONDS)

  return NextResponse.json({ status: 'updated' })
}
