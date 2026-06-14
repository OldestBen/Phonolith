export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getStatus } from '@/lib/analyst'

export async function GET() {
  const status = await getStatus()
  if (!status) {
    return NextResponse.json({ files_indexed: 0, last_scan: null, watching: false, online: false })
  }
  return NextResponse.json({ ...status, online: true })
}
