export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { hash: string } }) {
  const rows = await sql`
    SELECT lf.*, s.title AS song_title, ar.name AS song_artist, s.genius_id AS song_genius_id
    FROM library_files lf
    LEFT JOIN songs s ON lf.song_id = s.id
    LEFT JOIN artists ar ON s.artist_id = ar.id
    WHERE lf.blake3_hash = ${params.hash}
  `
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}
