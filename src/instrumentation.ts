export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/db')
    await runMigrations()
  }
}
