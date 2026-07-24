import { describe, it, expect, beforeEach } from 'vitest'
import {
  verifyInternalServiceToken,
  hashPassword,
  verifyPassword,
} from '@/lib/auth'

// Importing @/lib/auth pulls in @/lib/db, which constructs a postgres client
// but does NOT open a connection until a query runs. The functions under test
// here (token check + scrypt password hashing) never touch the database.

describe('verifyInternalServiceToken', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'test-secret-token'
  })

  it('accepts the exact configured token', () => {
    expect(verifyInternalServiceToken('test-secret-token')).toBe(true)
  })

  it('rejects a wrong token of the same length', () => {
    expect(verifyInternalServiceToken('test-secret-XXXXX')).toBe(false)
  })

  it('rejects a token of a different length', () => {
    expect(verifyInternalServiceToken('short')).toBe(false)
  })

  it('rejects null', () => {
    expect(verifyInternalServiceToken(null)).toBe(false)
  })

  it('rejects the empty string', () => {
    expect(verifyInternalServiceToken('')).toBe(false)
  })
})

describe('password hashing (scrypt round-trip)', () => {
  it('verifies a correct password against its own hash', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Tr0ubador&3', stored)).toBe(false)
  })

  it('produces a different salt (and thus hash) each call', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    // ...yet both still verify
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('returns false for a malformed stored value instead of throwing', async () => {
    expect(await verifyPassword('whatever', 'not-a-valid-hash')).toBe(false)
  })
})
