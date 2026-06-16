export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

const EDITABLE_FIELDS = ['title', 'artist', 'album', 'year', 'track_number', 'disc_number', 'engineer'] as const
type EditableField = typeof EDITABLE_FIELDS[number]

// PATCH /api/library/[hash]/metadata
// Body: { title?, artist?, album?, year?, track_number?, disc_number?, engineer? }
// Persists a metadata_overrides JSONB blob + sets metadata_locked = true, then —
// if id3_writeback_enabled is on and the file is local — best-effort rewrites
// the embedded tags on disk via the analyst sidecar.
export async function PATCH(req: NextRequest, { params }: { params: { hash: string } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>

  const overrides: Record<string, string | number | null> = {}
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) overrides[field] = body[field] as string | number | null
  }
  if (Object.keys(overrides).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  const rows = await sql`
    SELECT lf.file_path, lf.source_id, s.type AS source_type, lf.metadata_overrides
    FROM library_files lf
    LEFT JOIN library_sources s ON s.id = lf.source_id
    WHERE lf.blake3_hash = ${params.hash}
  `
  if (rows.length === 0) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const row = rows[0]
  const filePath = row.file_path as string
  const sourceType = (row.source_type as string | null) ?? 'local'
  const isLocal = sourceType !== 'smb' && !filePath.startsWith('\\\\') && !filePath.startsWith('//')

  const mergedOverrides: Record<string, string | number | null> = {
    ...(row.metadata_overrides as Record<string, string | number | null> | null ?? {}),
    ...overrides,
  }

  const setClauses: Record<EditableField, unknown> = {
    title: overrides.title ?? null,
    artist: overrides.artist ?? null,
    album: overrides.album ?? null,
    year: overrides.year ?? null,
    track_number: overrides.track_number ?? null,
    disc_number: overrides.disc_number ?? null,
    engineer: overrides.engineer ?? null,
  }

  await sql`
    UPDATE library_files
    SET
      metadata_locked    = TRUE,
      metadata_overrides = ${sql.json(mergedOverrides)},
      title         = CASE WHEN ${'title' in overrides}         THEN ${setClauses.title as string | null}         ELSE title         END,
      artist        = CASE WHEN ${'artist' in overrides}        THEN ${setClauses.artist as string | null}        ELSE artist        END,
      album         = CASE WHEN ${'album' in overrides}         THEN ${setClauses.album as string | null}         ELSE album         END,
      year          = CASE WHEN ${'year' in overrides}          THEN ${setClauses.year as string | null}          ELSE year          END,
      track_number  = CASE WHEN ${'track_number' in overrides}  THEN ${setClauses.track_number as number | null}  ELSE track_number  END,
      disc_number   = CASE WHEN ${'disc_number' in overrides}   THEN ${setClauses.disc_number as number | null}   ELSE disc_number   END,
      engineer      = CASE WHEN ${'engineer' in overrides}      THEN ${setClauses.engineer as string | null}      ELSE engineer      END
    WHERE blake3_hash = ${params.hash}
  `

  let writebackWarning: string | null = null
  const writebackEnabled = (await getSetting('id3_writeback_enabled')) === 'true'

  if (writebackEnabled && isLocal) {
    const analystUrl = process.env.ANALYST_URL || 'http://analyst:8000'
    try {
      const r = await fetch(`${analystUrl}/write-tags/${params.hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, ...overrides }),
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        writebackWarning = data.error ?? `Tag write-back failed (status ${r.status})`
      }
    } catch {
      writebackWarning = 'Could not reach analyst sidecar for tag write-back'
    }
  }

  return NextResponse.json({ ok: true, writeback_warning: writebackWarning })
}
