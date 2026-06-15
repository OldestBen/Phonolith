import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALG = 'aes-256-gcm'
const KEY_HEX = process.env.CREDENTIAL_KEY ?? ''

function getKey(): Buffer {
  if (KEY_HEX.length === 64) return Buffer.from(KEY_HEX, 'hex')
  // Derive a deterministic fallback from DATABASE_URL — not ideal for production
  // but prevents hard crashes when CREDENTIAL_KEY is not set.
  const seed = process.env.DATABASE_URL ?? 'phonolith-dev-key-not-for-production'
  const { createHash } = require('crypto') as typeof import('crypto')
  return createHash('sha256').update(seed).digest()
}

export function encryptConfig(obj: Record<string, unknown>): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key, iv)
  const plain = JSON.stringify(obj)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv(24 hex) + tag(32 hex) + ciphertext(hex)
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex')
}

export function decryptConfig(encrypted: string): Record<string, unknown> {
  try {
    const key = getKey()
    const iv = Buffer.from(encrypted.slice(0, 24), 'hex')
    const tag = Buffer.from(encrypted.slice(24, 56), 'hex')
    const data = Buffer.from(encrypted.slice(56), 'hex')
    const decipher = createDecipheriv(ALG, key, iv)
    decipher.setAuthTag(tag)
    const plain = decipher.update(data) + decipher.final('utf8')
    return JSON.parse(plain)
  } catch {
    return {}
  }
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.length > 56 && /^[0-9a-f]+$/.test(value)
}

/** Normalise a config value from DB — may be encrypted string, plain object, or JSON string. */
export function resolveConfig(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    if (isEncrypted(raw)) return decryptConfig(raw)
    try { return JSON.parse(raw) } catch { return {} }
  }
  return {}
}
