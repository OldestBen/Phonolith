export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

const LUCID_URL = process.env.LUCID_URL || 'http://lucid:8001'

async function proxy(req: NextRequest, slug: string[]) {
  const path = slug.join('/')
  const url = `${LUCID_URL}/${path}`

  const isGet = req.method === 'GET'
  const body = isGet ? undefined : await req.text()

  try {
    const res = await fetch(url, {
      method: req.method,
      headers: isGet ? undefined : { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ online: false, error: 'Lucid sidecar unreachable' }, { status: 503 })
  }
}

export async function GET(req: NextRequest, { params }: { params: { slug: string[] } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  return proxy(req, params.slug)
}

export async function POST(req: NextRequest, { params }: { params: { slug: string[] } }) {
  const user = await getUserFromSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  return proxy(req, params.slug)
}
