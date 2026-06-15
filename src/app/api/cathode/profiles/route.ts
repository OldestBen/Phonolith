export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

// GET /api/cathode/profiles  → list all profiles ordered by name
export async function GET() {
  const rows = await sql`
    SELECT id, name, description, device_type, components, total_hours, lucid_device, created_at
    FROM hardware_profiles
    ORDER BY name ASC
  `
  return NextResponse.json(rows)
}

// POST /api/cathode/profiles  → create new profile
// body: { name, description?, device_type?, components?: [{role, model}], lucid_device? }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name: string
    description?: string
    device_type?: string
    components?: Array<{ role: string; model: string }>
    lucid_device?: string
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const rows = await sql`
    INSERT INTO hardware_profiles (name, description, device_type, components, lucid_device)
    VALUES (
      ${body.name.trim()},
      ${body.description ?? null},
      ${body.device_type ?? 'system'},
      ${JSON.stringify(body.components ?? [])}::jsonb,
      ${body.lucid_device ?? null}
    )
    RETURNING id, name, description, device_type, components, total_hours, lucid_device, created_at
  `
  return NextResponse.json(rows[0], { status: 201 })
}
