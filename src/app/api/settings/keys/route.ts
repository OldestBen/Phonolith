export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting, clearSetting, getSettingMeta } from '@/lib/settings'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

// Whitelist of keys that can be managed via the UI
const ALLOWED_KEYS = new Set([
  'GENIUS_ACCESS_TOKEN',
  'DISCOGS_USER_TOKEN',
  'ACOUSTID_API_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'MUSICBRAINZ_CONTACT',
  'LUCID_DEVICE',
  'LUCID_ENDPOINT_NAME',
  'id3_writeback_enabled',
  'TAILSCALE_AUTHKEY',
  'CLOUDFLARE_TUNNEL_TOKEN',
  'SOULSEEK_USERNAME',
  'SOULSEEK_PASSWORD',
  'SLSKD_API_KEY',
])

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const key = req.nextUrl.searchParams.get('key')
  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }
  const meta = await getSettingMeta(key)
  return NextResponse.json({ key, ...meta })
}

export async function PUT(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { key, value } = await req.json() as { key: string; value: string }
  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }
  if (!value?.trim()) {
    return NextResponse.json({ error: 'Value cannot be empty' }, { status: 400 })
  }
  await setSetting(key, value.trim())
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const key = req.nextUrl.searchParams.get('key')
  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }
  await clearSetting(key)
  return NextResponse.json({ ok: true })
}
