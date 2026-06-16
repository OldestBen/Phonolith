export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const tags = await sql`SELECT * FROM tags ORDER BY name`
  return NextResponse.json(tags)
}

export async function POST(req: NextRequest) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { name, color } = await req.json() as { name: string; color?: string }
  if (!name?.trim()) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

  const rows = await sql`
    INSERT INTO tags (name, color)
    VALUES (${name.trim()}, ${color || '#a78bfa'})
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING *
  `
  return NextResponse.json(rows[0], { status: 201 })
}
