export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting, clearSetting, getSettingMeta } from '@/lib/settings'

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
])

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }
  const meta = await getSettingMeta(key)
  return NextResponse.json({ key, ...meta })
}

export async function PUT(req: NextRequest) {
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
  const key = req.nextUrl.searchParams.get('key')
  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }
  await clearSetting(key)
  return NextResponse.json({ ok: true })
}
