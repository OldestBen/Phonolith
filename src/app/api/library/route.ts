export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET() {
  const rows = await sql`
    SELECT lf.*, s.title AS song_title, ar.name AS song_artist
    FROM library_files lf
    LEFT JOIN songs s ON lf.song_id = s.id
    LEFT JOIN artists ar ON s.artist_id = ar.id
    ORDER BY lf.indexed_at DESC
  `
  return NextResponse.json(rows)
}
