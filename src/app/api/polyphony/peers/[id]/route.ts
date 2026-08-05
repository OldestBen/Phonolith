import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (body.trust_status !== undefined && body.trust_status !== 'trusted' && body.trust_status !== 'blocked') {
    return NextResponse.json({ error: 'trust_status must be "trusted" or "blocked".' }, { status: 400 })
  }

  const hasLibrary = body.share_library !== undefined
  const hasPresence = body.share_presence !== undefined
  const hasBackup = body.share_backup !== undefined
  const hasTrust = body.trust_status !== undefined

  await sql`
    UPDATE peers
    SET
      share_library  = CASE WHEN ${hasLibrary}  THEN ${hasLibrary ? Boolean(body.share_library) : null}  ELSE share_library  END,
      share_presence = CASE WHEN ${hasPresence} THEN ${hasPresence ? Boolean(body.share_presence) : null} ELSE share_presence END,
      share_backup   = CASE WHEN ${hasBackup}   THEN ${hasBackup ? Boolean(body.share_backup) : null}   ELSE share_backup   END,
      trust_status   = CASE WHEN ${hasTrust}    THEN ${hasTrust ? (body.trust_status as string) : null} ELSE trust_status   END
    WHERE id = ${id}
  `

  const rows = await sql`SELECT id, name, host, trust_status, share_library, share_presence, share_backup FROM peers WHERE id = ${id}`
  if (rows.length === 0) return NextResponse.json({ error: 'Peer not found.' }, { status: 404 })
  return NextResponse.json({ peer: rows[0] })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { id } = await params
  await sql`DELETE FROM peers WHERE id = ${id}`
  return NextResponse.json({ status: 'unpaired' })
}
