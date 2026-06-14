export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { triggerScan } from '@/lib/analyst'

export async function POST() {
  try {
    await triggerScan()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Analyst sidecar unavailable' }, { status: 502 })
  }
}
