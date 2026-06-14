import postgres from 'postgres'
import fs from 'fs'
import path from 'path'

const connectionString = process.env.DATABASE_URL || 'postgresql://phonolith:phonolith@localhost:5432/phonolith'

// Singleton for Next.js hot reload
const globalForSql = globalThis as unknown as { sql: ReturnType<typeof postgres> }

export const sql = globalForSql.sql ?? postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

if (process.env.NODE_ENV !== 'production') {
  globalForSql.sql = sql
}

export async function runMigrations() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  const migrationsDir = path.join(process.cwd(), 'src', 'migrations')

  if (!fs.existsSync(migrationsDir)) return

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const rows = await sql`
      SELECT filename FROM schema_migrations WHERE filename = ${file}
    `
    if (rows.length > 0) continue

    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    await sql.unsafe(sqlContent)
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`
    console.log(`[db] applied migration: ${file}`)
  }
}
