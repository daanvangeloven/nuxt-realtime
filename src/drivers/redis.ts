import type { WatchCallback } from 'unstorage'
import { joinKeys } from 'unstorage'
import redisDriver from 'unstorage/drivers/redis'
import { Redis, type Cluster, type ClusterNode, type ClusterOptions } from 'ioredis'
import type { ConsolaInstance } from 'consola'
import type { LockCapableDriver } from '../runtime/server/utils/lock'

const STORAGE_CHANNEL = 'nuxt-realtime:watch'

// CAS scripts run on the `pub` connection (see RealtimePubSub below): `sub` is a dedicated
// subscriber connection and Redis restricts subscriber connections to pub/sub commands.
const CLAIM_LOCK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1])
  if tonumber(ARGV[2]) > 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 1
end
return 0
`

const RELEASE_LOCK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`

interface RedisWithLockCommands extends Redis {
  claimLock: (key: string, owner: string, ttlMs: number) => Promise<number>
  releaseLock: (key: string, owner: string) => Promise<number>
}

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
   * Cluster nodes. Takes priority over `url`/`host`/`port`.
   * @example
   * ```ts
   * cluster: [{ host: 'redis-1', port: 6379 }, { host: 'redis-2', port: 6379 }]
   * ```
   */
  cluster?: ClusterNode[]
  /**
   * Options passed to the ioredis cluster client (e.g. `redisOptions`, `scaleReads`).
   */
  clusterOptions?: ClusterOptions
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
  /**
   * Shared pub/sub service. When provided, the driver reuses its connections
   * instead of opening a dedicated pub/sub pair.
   */
  pubsub?: RealtimePubSub
  /**
   * Logger instance for internal driver messages. When omitted, falls back to `console.error`.
   */
  logger?: ConsolaInstance
}

function createRedisClient(opts: ReactiveRedisDriverOptions): Redis | Cluster {
  if (opts.cluster) {
    return new Redis.Cluster(opts.cluster, opts.clusterOptions)
  }
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
 * Shared pub/sub service that manages a single Redis publish connection and a
 * single subscribe connection, regardless of how many features use pub/sub.
 *
 * Multiple channels and handlers are multiplexed over the same two connections.
 */
export class RealtimePubSub {
  private pub: Redis | Cluster
  private sub: Redis | Cluster
  private handlers = new Map<string, Set<(message: string) => void>>()
  readonly instanceId = crypto.randomUUID()

  constructor(opts: ReactiveRedisDriverOptions) {
    this.pub = createRedisClient(opts)
    this.sub = createRedisClient(opts)

    this.pub.defineCommand('claimLock', { numberOfKeys: 1, lua: CLAIM_LOCK_SCRIPT })
    this.pub.defineCommand('releaseLock', { numberOfKeys: 1, lua: RELEASE_LOCK_SCRIPT })

    this.sub.on('message', (channel, message) => {
      const channelHandlers = this.handlers.get(channel)
      if (channelHandlers) {
        for (const handler of channelHandlers) handler(message)
      }
    })
  }

  async claimLock(key: string, owner: string, ttlMs = 0): Promise<boolean> {
    const result = await (this.pub as RedisWithLockCommands).claimLock(key, owner, ttlMs)
    return result === 1
  }

  async releaseLock(key: string, owner: string): Promise<boolean> {
    const result = await (this.pub as RedisWithLockCommands).releaseLock(key, owner)
    return result === 1
  }

  async publish(channel: string, data: unknown) {
    await this.pub.publish(channel, JSON.stringify(data))
  }

  /**
   * Subscribes to a Redis channel. Returns an unsubscribe function.
   */
  subscribe(channel: string, handler: (message: string) => void): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set())
      this.sub.subscribe(channel)
    }
    this.handlers.get(channel)!.add(handler)
    return () => {
      this.handlers.get(channel)?.delete(handler)
    }
  }

  async dispose() {
    this.pub.disconnect()
    this.sub.disconnect()
  }
}

/**
 * A reactive unstorage driver that wraps the built-in Redis driver and adds
 * pub/sub-based cross-instance change notifications.
 *
 * Storage (CRUD) is handled by the underlying unstorage Redis driver.
 * Reactivity (cross-server change notification) is layered on top via a
 * `RealtimePubSub` instance either provided externally (shared) or created
 * internally (dedicated pair of connections).
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
 *
 * @example
 * ```ts
 * // nuxt.config.ts with Redis Cluster in production
 * import { reactiveRedisDriver } from 'nuxt-realtime/drivers/redis'
 *
 * export default defineNuxtConfig({
 *   nuxtRealtime: {
 *     storage: reactiveRedisDriver({
 *       cluster: [{ host: 'redis-1', port: 6379 }, { host: 'redis-2', port: 6379 }],
 *     }),
 *   },
 * })
 * ```
 */
export function reactiveRedisDriver(opts: ReactiveRedisDriverOptions = {}): LockCapableDriver {
  const { pubsub: externalPubSub, logger, ...baseOpts } = opts
  const base = redisDriver(baseOpts)
  const toRedisKey = (key: string) => joinKeys(baseOpts.base ?? '', key)

  const pubsub = externalPubSub ?? new RealtimePubSub(opts)
  const ownsPubSub = !externalPubSub

  const { instanceId } = pubsub
  const listeners = new Set<WatchCallback>()

  const unsubscribe = pubsub.subscribe(STORAGE_CHANNEL, (message) => {
    try {
      const { event, key, origin } = JSON.parse(message) as { event: string, key: string, origin: string }
      if (origin === instanceId) return
      for (const cb of listeners) cb(event as 'update' | 'remove', key)
    }
    catch (e) {
      if (logger) {
        logger.error('reactiveRedisDriver: failed to parse pub/sub message', e)
      }
      else {
        console.error('[nuxt-realtime] reactiveRedisDriver: failed to parse pub/sub message', e)
      }
    }
  })

  return {
    ...base,

    async setItem(key, value, setOpts) {
      await base.setItem!(key, value, setOpts)
      await pubsub.publish(STORAGE_CHANNEL, { event: 'update', key, origin: instanceId })
    },

    async removeItem(key, removeOpts) {
      await base.removeItem!(key, removeOpts)
      await pubsub.publish(STORAGE_CHANNEL, { event: 'remove', key, origin: instanceId })
    },

    watch(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },

    async claimLock(key, owner, ttlMs) {
      return pubsub.claimLock(toRedisKey(key), owner, ttlMs)
    },

    async releaseLock(key, owner) {
      return pubsub.releaseLock(toRedisKey(key), owner)
    },

    async dispose() {
      unsubscribe()
      listeners.clear()
      if (ownsPubSub) {
        await pubsub.dispose()
      }
      await base.dispose?.()
    },
  }
}
