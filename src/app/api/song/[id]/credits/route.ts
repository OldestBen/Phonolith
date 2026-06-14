export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { rget, rset } from '@/lib/redis'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const cacheKey = `credits:${id}`
  const cached = await rget(cacheKey)
  if (cached) return NextResponse.json(cached)

  const rows = await sql`
    SELECT c.role, c.name, c.genius_id
    FROM credits c
    JOIN songs s ON c.song_id = s.id
    WHERE s.genius_id = ${id}
    ORDER BY c.id
  `

  await rset(cacheKey, rows, 300)
  return NextResponse.json(rows)
}
