export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const rows = await sql`SELECT description FROM songs WHERE genius_id = ${id}`
  if (rows.length === 0) return NextResponse.json({ description: null })

  return NextResponse.json({ description: rows[0].description })
}
