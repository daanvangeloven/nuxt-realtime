import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineNitroPlugin, useStorage, useRuntimeConfig } from 'nitropack/runtime'
import { Server as Engine, type ServerOptions } from 'engine.io'
import { Server } from 'socket.io'
import { defineEventHandler, getQuery, createError } from 'h3'
import { createRealtimeLogger } from '../utils/logger'
import { devtoolsState, createEventLog, getConnectionSummaries, getStorageSnapshot, type DevtoolsEventType, type DevtoolsIoLike } from '../utils/devtools-state'

// Nitro/h3/crossws don't expose typed access to the underlying Node.js objects,
// but Engine.IO requires them. These interfaces document the internal properties we rely on.
interface NodeEvent {
  node: { req: IncomingMessage, res: ServerResponse }
  _handled: boolean
}

interface WebSocketPeer {
  _internal: { nodeReq: IncomingMessage & { socket: Duplex } }
  websocket: WebSocket
}

// Engine.IO's prepare() and onWebSocket() are private in its type definitions,
// but are needed to bridge Nitro's WebSocket handling with Engine.IO.
interface EngineWithInternals {
  prepare: (req: IncomingMessage) => void
  onWebSocket: (req: IncomingMessage, socket: Duplex, websocket: WebSocket) => void
}

// Minimal interface for the shared pub/sub service used within this plugin.
// The concrete implementation (RealtimePubSub) lives in drivers/redis.ts.
interface PubSubService {
  instanceId: string
  publish(channel: string, data: unknown): Promise<void>
  subscribe(channel: string, handler: (message: string) => void): () => void
  dispose(): Promise<void>
}

const EVENT_CHANNEL = 'nuxt-realtime:events'

/**
 * Returns all Socket.IO room names that should receive an event published to `channel`.
 * Includes the exact channel room, all namespace-prefix wildcard rooms, and the global wildcard room.
 *
 * e.g. 'chat:room:message' → ['event:chat:room:message', 'event:chat:room:*', 'event:chat:*', 'event:*']
 */
function wildcardRooms(channel: string): string[] {
  const rooms: string[] = [`event:${channel}`, 'event:*']
  const parts = channel.split(':')
  for (let i = 1; i < parts.length; i++) {
    rooms.push(`event:${parts.slice(0, i).join(':')}:*`)
  }
  return rooms
}

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  const realtimePublicConfig = config.public.nuxtRealtime as {
    cleanup: { heartbeatInterval: number, cleanupInterval: number, idleThreshold: number } | false
    logging: { level: string | null, format: string }
    devtoolsEnabled: boolean
  }
  const cleanupConfig = realtimePublicConfig.cleanup
  const logger = createRealtimeLogger(realtimePublicConfig.logging.level, realtimePublicConfig.logging.format)

  const socketioConfig = (config as { nuxtRealtime?: { socketio?: { path?: string, serverOptions?: ServerOptions } } }).nuxtRealtime?.socketio
  const serverOptions = socketioConfig?.serverOptions

  // Must match the client's derivation in plugin.client.ts (`socketPath || '/socket.io'`)
  // so the handshake path the client connects to is the same one the server listens on.
  const socketPath = socketioConfig?.path || '/socket.io'
  const socketRoutePath = socketPath.endsWith('/') ? socketPath : `${socketPath}/`

  const devtoolsEnabled = realtimePublicConfig.devtoolsEnabled
  const eventLogSize = (config as { nuxtRealtime?: { eventLogSize?: number } }).nuxtRealtime?.eventLogSize
  // No-op when devtools is disabled
  function record(type: DevtoolsEventType, socketId: string, detail?: string): void {
    if (devtoolsEnabled) {
      devtoolsState.eventLog.record(type, socketId, detail)
    }
  }

  const io = new Server()
  const engine = new Engine({ ...serverOptions })

  if (devtoolsEnabled) {
    devtoolsState.io = io as unknown as DevtoolsIoLike
    devtoolsState.eventLog = createEventLog(eventLogSize ?? 200)
  }

  // When Redis options are provided, create a shared pub/sub service and mount
  // the reactive driver. The pub/sub service is shared between the storage
  // driver and the event relay so the total stays at 2 Redis connections.
  const redisOpts = (config as { nuxtRealtime?: { redis?: Record<string, unknown> } }).nuxtRealtime?.redis
  let pubsub: PubSubService | null = null

  if (redisOpts) {
    const driverPath = 'nuxt-realtime/drivers/redis'
    const { reactiveRedisDriver, RealtimePubSub } = await import(driverPath)
    pubsub = new RealtimePubSub(redisOpts)
    const rootStorage = useStorage() as unknown as { mount: (base: string, driver: unknown) => void, unmount: (base: string) => Promise<void> }
    await rootStorage.unmount('nuxt-realtime')
    rootStorage.mount('nuxt-realtime', reactiveRedisDriver({ ...redisOpts, pubsub, logger }))
  }

  const storage = useStorage('nuxt-realtime')

  async function touchLease(key: string) {
    await storage.setItem(`_lease:${key}`, { lastSeen: Date.now() })
  }

  // Cross-server sync: watch for writes from other server instances and broadcast
  // to locally subscribed Socket.IO clients. Drivers that don't support native
  // watch (e.g. memory) still work updates are just local to each instance.
  //
  // NOTE: prefixStorage() does not wrap `watch`, so storage.watch() delegates to
  // the root storage and keys arrive with the full "nuxt-realtime:" prefix.
  // Strip it before using the key with the namespaced `storage` or room names.
  const STORAGE_PREFIX = 'nuxt-realtime:'
  const unwatch = await storage.watch(async (event, key) => {
    try {
      if (event !== 'update' && event !== 'remove') return
      if (!key.startsWith(STORAGE_PREFIX)) return

      const relKey = key.slice(STORAGE_PREFIX.length)
      if (relKey.startsWith('_lease:')) return

      const value = await storage.getItem(relKey)
      const room = `key:${relKey}`
      if (io.sockets.adapter.rooms.has(room)) {
        io.to(room).emit('storage:updated', { key: relKey, value })
      }
    }
    catch (error) {
      logger.error('Watch callback error:', error)
    }
  })

  if (!unwatch || typeof unwatch !== 'function') {
    logger.warn(
      'Storage driver does not support watch. '
      + 'Cross-server sync is disabled. Updates from other server instances '
      + 'will only be visible to clients on reconnect/refresh. '
      + 'Consider using reactiveRedisDriver from nuxt-realtime/drivers/redis.',
    )
  }

  // Cross-server event relay: forward events published on other server instances
  // to locally subscribed Socket.IO clients. When no pub/sub is configured the
  // event system falls back to single-server behavior.
  let unsubscribeEvents: (() => void) | null = null
  let cleanupIntervalId: ReturnType<typeof setInterval> | null = null

  if (pubsub) {
    unsubscribeEvents = pubsub.subscribe(EVENT_CHANNEL, (message) => {
      try {
        const { channel, data, origin } = JSON.parse(message) as { channel: string, data: unknown, origin: string }
        if (origin === pubsub!.instanceId) return

        const rooms = wildcardRooms(channel).filter(r => io.sockets.adapter.rooms.has(r))
        if (rooms.length > 0) {
          io.to(rooms).emit('event:received', { channel, data })
        }
      }
      catch (e) {
        logger.error('Event relay: failed to parse pub/sub message', e)
      }
    })
  }
  else {
    logger.warn(
      'No Redis pub/sub configured. '
      + 'Cross-server event sync is disabled. Events published on one server instance '
      + 'will not reach clients connected to other instances. '
      + 'Consider configuring Redis via nuxtRealtime.redis in nuxt.config.ts.',
    )
  }

  nitroApp.hooks.hook('close', async () => {
    if (cleanupIntervalId !== null) {
      clearInterval(cleanupIntervalId)
    }
    if (typeof unwatch === 'function') {
      await unwatch()
    }
    unsubscribeEvents?.()
    await pubsub?.dispose()
  })

  await nitroApp.hooks.callHook('nuxt-realtime:io', io)

  io.bind(engine)

  io.on('connection', (socket) => {
    logger.debug('Client connected:', socket.id)
    record('connect', socket.id)

    socket.on('disconnect', (reason) => {
      record('disconnect', socket.id, reason)
    })

    // Storage operations
    socket.on('storage:get', async (key: string, callback) => {
      try {
        const value = await storage.getItem(key)
        callback(value)
      }
      catch (error) {
        logger.error('Storage get error:', error)
        callback(null)
      }
    })

    socket.on('storage:set', async ({ key, value }, callback) => {
      try {
        await storage.setItem(key, value)
        await touchLease(key)
        socket.to(`key:${key}`).emit('storage:updated', { key, value })
        record('storage:set', socket.id, key)

        if (callback) {
          callback({
            success: true,
            status: 'ok',
          })
        }
      }
      catch (error) {
        logger.error('Storage set error:', error)
        if (callback) {
          callback({
            success: false,
            error: 'Error while updating storage value',
          })
        }
      }
    })

    socket.on('storage:subscribe', async (key: string) => {
      socket.join(`key:${key}`)
      record('storage:subscribe', socket.id, key)
      try {
        await touchLease(key)
      }
      catch (error) {
        logger.error('Lease touch error on subscribe:', error)
      }
    })

    socket.on('storage:unsubscribe', (key: string) => {
      socket.leave(`key:${key}`)
      record('storage:unsubscribe', socket.id, key)
    })

    socket.on('storage:heartbeat', async () => {
      try {
        // Touch leases for all keys this socket is subscribed to
        const storageRooms = [...socket.rooms].filter(r => r.startsWith('key:'))
        await Promise.all(storageRooms.map(room => touchLease(room.slice('key:'.length))))
      }
      catch (error) {
        logger.error('Heartbeat error:', error)
      }
    })

    // Event pub/sub operations
    socket.on('event:subscribe', (channel: string) => {
      socket.join(`event:${channel}`)
      record('event:subscribe', socket.id, channel)
    })

    socket.on('event:unsubscribe', (channel: string) => {
      socket.leave(`event:${channel}`)
      record('event:unsubscribe', socket.id, channel)
    })

    socket.on('event:publish', async ({ channel, data, includeSelf }, callback) => {
      try {
        // 1. Broadcast immediately to local subscribers (exact channel + wildcard rooms).
        //    Passing an array to .to() causes Socket.IO to deduplicate recipients, so a
        //    client subscribed to multiple matching rooms receives the event only once.
        const rooms = wildcardRooms(channel)
        if (includeSelf) {
          io.to(rooms).emit('event:received', { channel, data })
        }
        else {
          socket.to(rooms).emit('event:received', { channel, data })
        }

        // 2. Relay to other server instances via shared pub/sub
        if (pubsub) {
          await pubsub.publish(EVENT_CHANNEL, { channel, data, origin: pubsub.instanceId })
        }

        record('event:publish', socket.id, channel)

        if (callback) {
          callback({ success: true })
        }
      }
      catch (error) {
        logger.error('Event publish error:', error)
        if (callback) {
          callback({ success: false, error: 'Error while publishing event' })
        }
      }
    })
  })

  // Cleanup job
  if (cleanupConfig) {
    const { cleanupInterval, idleThreshold } = cleanupConfig

    // Add jitter (±10%) so multiple servers don't all scan at the same instant
    const jitter = cleanupInterval * 0.1
    const interval = cleanupInterval + Math.random() * jitter * 2 - jitter

    cleanupIntervalId = setInterval(async () => {
      try {
        const allKeys = await storage.getKeys()
        const leaseKeys = allKeys.filter(k => k.startsWith('_lease:'))

        for (const leaseKey of leaseKeys) {
          const lease = await storage.getItem<{ lastSeen: number }>(leaseKey)
          if (lease && Date.now() - lease.lastSeen > idleThreshold) {
            const dataKey = leaseKey.slice('_lease:'.length)
            await storage.removeItem(leaseKey)
            await storage.removeItem(dataKey)
            logger.debug(`Cleaned up idle key: ${dataKey}`)
          }
        }
      }
      catch (error) {
        logger.error('Cleanup job error:', error)
      }
    }, interval)
  }

  const engineWithInternals = engine as unknown as EngineWithInternals
  // There currently is no better way to use socket.io with crossws
  // https://socket.io/how-to/use-with-nuxt#hook-the-socketio-server
  // https://github.com/h3js/crossws/issues/138
  nitroApp.router.use(socketRoutePath, defineEventHandler({
    handler(event: unknown) {
      const nodeEvent = event as unknown as NodeEvent
      engine.handleRequest(nodeEvent.node.req as Parameters<Engine['handleRequest']>[0], nodeEvent.node.res)
      nodeEvent._handled = true
    },
    websocket: {
      open(peer: unknown) {
        const { _internal, websocket } = peer as unknown as WebSocketPeer
        engineWithInternals.prepare(_internal.nodeReq)
        engineWithInternals.onWebSocket(_internal.nodeReq, _internal.nodeReq.socket, websocket)
      },
    },
  }))

  // Dev-only introspection endpoint backing the Nuxt DevTools "Realtime" tab.
  if (devtoolsEnabled) {
    nitroApp.router.use('/__nuxt-realtime__/devtools', defineEventHandler(async (event) => {
      const query = getQuery(event)
      switch (query.type) {
        case 'connections':
          return getConnectionSummaries(devtoolsState.io!)
        case 'storage':
          return getStorageSnapshot(storage, devtoolsState.io!)
        case 'events':
          return devtoolsState.eventLog.list(query.sinceId ? Number(query.sinceId) : undefined)
        default:
          throw createError({ statusCode: 400, statusMessage: 'nuxt-realtime devtools: unknown query type' })
      }
    }))
  }
})
