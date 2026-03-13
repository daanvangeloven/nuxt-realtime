import type { Driver, WatchCallback } from 'unstorage'
import redisDriver from 'unstorage/drivers/redis'
import { Redis } from 'ioredis'

const CHANNEL = 'nuxt-realtime:watch'

export interface ReactiveRedisDriverOptions {
  /**
   * Key prefix for all stored values.
   */
  base?: string
  /**
   * Redis host. Ignored when `url` is set.
   * @default 'localhost'
   */
  host?: string
  /**
   * Redis port. Ignored when `url` is set.
   * @default 6379
   */
  port?: number
  /**
   * Redis connection URL (e.g. `redis://localhost:6379`). Takes priority over host/port.
   */
  url?: string
  /**
   * Redis password.
   */
  password?: string
  /**
   * Redis database index.
   */
  db?: number
  /**
   * TLS options passed to ioredis.
   */
  tls?: object
}

function createRedisClient(opts: ReactiveRedisDriverOptions): Redis {
  if (opts.url) {
    return new Redis(opts.url)
  }
  return new Redis({
    host: opts.host,
    port: opts.port,
    password: opts.password,
    db: opts.db,
    tls: opts.tls as Redis['options']['tls'],
  })
}

/**
 * A reactive unstorage driver that wraps the built-in Redis driver and adds
 * pub/sub-based cross-instance change notifications.
 *
 * Storage (CRUD) is handled by the underlying unstorage Redis driver.
 * Reactivity (cross-server change notification) is layered on top via two
 * dedicated ioredis pub/sub connections.
 *
 * @example
 * ```ts
 * // nuxt.config.ts
 * import { reactiveRedisDriver } from 'nuxt-realtime/drivers/redis'
 *
 * export default defineNuxtConfig({
 *   nuxtRealtime: {
 *     storage: reactiveRedisDriver({ host: 'localhost', port: 6379 }),
 *   },
 * })
 * ```
 */
export function reactiveRedisDriver(opts: ReactiveRedisDriverOptions = {}): Driver {
  const base = redisDriver(opts)
  const pub = createRedisClient(opts)
  const sub = createRedisClient(opts)

  const instanceId = crypto.randomUUID()
  const listeners = new Set<WatchCallback>()

  sub.subscribe(CHANNEL)
  sub.on('message', (_channel, message) => {
    try {
      const { event, key, origin } = JSON.parse(message) as { event: string, key: string, origin: string }
      // Skip events that originated from this instance — the storage:set handler
      // already broadcasts to local Socket.IO clients immediately.
      if (origin === instanceId) return
      for (const cb of listeners) cb(event as 'update' | 'remove', key)
    }
    catch (e) {
      console.error('[nuxt-realtime] reactiveRedisDriver: failed to parse pub/sub message', e)
    }
  })

  return {
    ...base,

    async setItem(key, value, setOpts) {
      await base.setItem!(key, value, setOpts)
      await pub.publish(CHANNEL, JSON.stringify({ event: 'update', key, origin: instanceId }))
    },

    async removeItem(key, removeOpts) {
      await base.removeItem!(key, removeOpts)
      await pub.publish(CHANNEL, JSON.stringify({ event: 'remove', key, origin: instanceId }))
    },

    watch(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },

    async dispose() {
      listeners.clear()
      pub.disconnect()
      sub.disconnect()
      await base.dispose?.()
    },
  }
}
