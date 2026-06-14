import { sql } from './db'
import { rget, rset, rdel } from './redis'

// Read a setting: DB value overrides env var. Redis-cached for 60s.
export async function getSetting(key: string): Promise<string | undefined> {
  try {
    const cacheKey = `setting:${key}`
    const cached = await rget(cacheKey)
    if (cached !== null) return (cached as string) || undefined

    const rows = await sql`SELECT value FROM app_settings WHERE key = ${key} LIMIT 1`
    const dbVal: string | null = rows[0]?.value ?? null
    await rset(cacheKey, dbVal ?? '', 60)
    return dbVal || process.env[key] || undefined
  } catch {
    // DB not ready yet (startup) — fall back to env
    return process.env[key] || undefined
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  await rdel(`setting:${key}`)
}

export async function clearSetting(key: string): Promise<void> {
  await sql`DELETE FROM app_settings WHERE key = ${key}`
  await rdel(`setting:${key}`)
}

// Returns source and a masked representation (last 4 chars visible).
export async function getSettingMeta(key: string): Promise<{
  source: 'db' | 'env' | 'unset'
  masked: string
}> {
  try {
    const rows = await sql`SELECT value FROM app_settings WHERE key = ${key} LIMIT 1`
    if (rows.length > 0 && rows[0].value) {
      const v = rows[0].value as string
      return { source: 'db', masked: '•'.repeat(Math.max(4, v.length - 4)) + v.slice(-4) }
    }
  } catch {}
  const envVal = process.env[key]
  if (envVal) {
    return { source: 'env', masked: '•'.repeat(Math.max(4, envVal.length - 4)) + envVal.slice(-4) }
  }
  return { source: 'unset', masked: '' }
}
