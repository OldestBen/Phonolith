import crypto from 'crypto'
import { sql } from '@/lib/db'
import { getSetting, setSetting } from '@/lib/settings'

export interface Peer {
  id: string
  name: string
  host: string
  shared_secret: string
  trust_status: 'trusted' | 'blocked'
  share_library: boolean
  share_presence: boolean
  share_backup: boolean
  paired_at: string
  last_seen_at: string | null
}

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000

export const NOW_PLAYING_KEY = 'polyphony:now_playing'
export const NOW_PLAYING_TTL_SECONDS = 120

/** This instance's stable Polyphony identity, generated once and persisted in app_settings. */
export async function getOwnPeerId(): Promise<string> {
  const existing = await getSetting('polyphony_peer_id')
  if (existing) return existing
  const id = crypto.randomUUID()
  await setSetting('polyphony_peer_id', id)
  return id
}

export async function getOwnName(): Promise<string> {
  return (await getSetting('polyphony_instance_name')) || 'Phonolith'
}

export async function isPublicDiscoveryEnabled(): Promise<boolean> {
  return (await getSetting('polyphony_public_discovery_enabled')) === 'true'
}

/** Generate a short, single-use, time-limited pairing code. */
export async function generatePairingCode(): Promise<{ code: string; expiresAt: Date }> {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase() // 8 hex chars
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)
  await sql`
    DELETE FROM peer_pairing_codes WHERE expires_at < NOW()
  `
  await sql`
    INSERT INTO peer_pairing_codes (code, expires_at) VALUES (${code}, ${expiresAt})
  `
  return { code, expiresAt }
}

/** Redeem a pairing code exactly once. Returns true if it was valid and unexpired. */
export async function redeemPairingCode(code: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM peer_pairing_codes
    WHERE code = ${code} AND expires_at > NOW()
    RETURNING code
  `
  return rows.length > 0
}

/** HMAC-SHA256 over a canonical "METHOD\npath\nbody" string, using the peer's shared secret. */
export function signPeerRequest(secret: string, method: string, path: string, body: string): string {
  const canonical = `${method.toUpperCase()}\n${path}\n${body}`
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(canonical).digest('hex')
}

export function verifyPeerSignature(secret: string, method: string, path: string, body: string, signature: string): boolean {
  const expected = signPeerRequest(secret, method, path, body)
  const sigBuf = Buffer.from(signature, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expectedBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expectedBuf)
}

/**
 * Verify the headers on an incoming peer-to-peer request (X-Polyphony-Peer-Id,
 * X-Polyphony-Signature) against the stored shared secret for that peer.
 * Returns the trusted peer row on success, or null otherwise. Updates last_seen_at.
 */
export async function verifyIncomingPeer(
  peerId: string | null,
  signature: string | null,
  method: string,
  path: string,
  body: string
): Promise<Peer | null> {
  if (!peerId || !signature) return null
  const rows = await sql`SELECT * FROM peers WHERE id = ${peerId} LIMIT 1`
  const peer = rows[0] as Peer | undefined
  if (!peer || peer.trust_status !== 'trusted') return null
  if (!verifyPeerSignature(peer.shared_secret, method, path, body, signature)) return null

  await sql`UPDATE peers SET last_seen_at = NOW() WHERE id = ${peerId}`
  return peer
}

export function generateSharedSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** Make a signed GET/POST request to a trusted peer's Polyphony API, identifying ourselves. */
export async function fetchFromPeer(
  peer: Peer,
  path: string,
  init: { method?: string; body?: string } = {}
): Promise<Response> {
  const method = init.method ?? 'GET'
  const body = init.body ?? ''
  const ownId = await getOwnPeerId()
  const signature = signPeerRequest(peer.shared_secret, method, path, body)

  return fetch(`${peer.host}${path}`, {
    method,
    body: init.body,
    signal: AbortSignal.timeout(8000),
    headers: {
      'Content-Type': 'application/json',
      'X-Polyphony-Peer-Id': ownId,
      'X-Polyphony-Signature': signature,
    },
  })
}
