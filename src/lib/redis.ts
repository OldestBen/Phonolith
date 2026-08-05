import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis: Redis }

export const redis = globalForRedis.redis ?? new Redis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  { lazyConnect: true, enableOfflineQueue: false }
)

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}

export async function rget<T>(key: string): Promise<T | null> {
  try {
    const val = await redis.get(key)
    return val ? (JSON.parse(val) as T) : null
  } catch {
    return null
  }
}

export async function rset(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Redis unavailable — degrade gracefully
  }
}

export async function rdel(key: string): Promise<void> {
  try {
    await redis.del(key)
  } catch {
    // ignore
  }
}
