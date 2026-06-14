export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET(req: NextRequest) {
  const artistId = req.nextUrl.searchParams.get('artist_id')
  const event = req.nextUrl.searchParams.get('event')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')

  let rows
  if (artistId) {
    rows = await sql`
      SELECT h.*, s.title AS song_title, ar.name AS artist_name
      FROM history h
      LEFT JOIN songs s ON h.song_id = s.id
      LEFT JOIN artists ar ON h.artist_id = ar.id
      WHERE h.artist_id = ${parseInt(artistId)}
      ORDER BY h.created_at DESC
      LIMIT ${limit}
    `
  } else if (event) {
    rows = await sql`
      SELECT h.*, s.title AS song_title, ar.name AS artist_name
      FROM history h
      LEFT JOIN songs s ON h.song_id = s.id
      LEFT JOIN artists ar ON h.artist_id = ar.id
      WHERE h.event = ${event}
      ORDER BY h.created_at DESC
      LIMIT ${limit}
    `
  } else {
    rows = await sql`
      SELECT h.*, s.title AS song_title, ar.name AS artist_name
      FROM history h
      LEFT JOIN songs s ON h.song_id = s.id
      LEFT JOIN artists ar ON h.artist_id = ar.id
      ORDER BY h.created_at DESC
      LIMIT ${limit}
    `
  }

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { song_id, artist_id, event } = await req.json() as {
    song_id?: number
    artist_id?: number
    event: string
  }

  if (!event) return NextResponse.json({ error: 'Missing event' }, { status: 400 })

  const rows = await sql`
    INSERT INTO history (song_id, artist_id, event)
    VALUES (${song_id ?? null}, ${artist_id ?? null}, ${event})
    RETURNING *
  `
  return NextResponse.json(rows[0], { status: 201 })
}
