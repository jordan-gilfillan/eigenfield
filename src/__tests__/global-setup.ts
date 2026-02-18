import { Client } from 'pg'
import { loadEnv } from 'vite'

export default async function globalSetup(): Promise<() => Promise<void>> {
  const env = loadEnv('test', process.cwd(), '')
  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Set it in .env or as an environment variable.\n' +
        'Example: DATABASE_URL="postgresql://postgres:postgres@localhost:5432/journal_distill"',
    )
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  })

  try {
    await client.connect()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Postgres is not reachable at DATABASE_URL.\n` +
        `Connection error: ${message}\n` +
        `Ensure Postgres is running: docker compose up -d db`,
    )
  } finally {
    await client.end().catch(() => {})
  }

  return async () => {
    try {
      const { closeLockPool } = await import('../lib/services/advisory-lock')
      await closeLockPool()
    } catch (err) {
      console.warn('globalTeardown: failed to close advisory lock pool:', err)
    }
  }
}
