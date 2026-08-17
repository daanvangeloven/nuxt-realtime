import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineNitroPlugin, useStorage, useRuntimeConfig } from 'nitropack/runtime'
import { Server as Engine, type ServerOptions } from 'engine.io'
import { Server } from 'socket.io'
import { defineEventHandler, getQuery, createError } from 'h3'
import { createRealtimeLogger } from '../utils/logger'
import { claimLock, getLockOwner, getLockOwnerInfo, getLockRoom, getLocksOwnedBy, getRoomKeys, releaseLock, touchLease } from '../utils/lock'
import type { PubSubDriver } from '../utils/pubsub'
import { createConnectionRegistry } from '../utils/connection-registry'
import { getPresenceSnapshot, getRoomsForConnection as getPresenceRoomsForConnection, joinPresence, leavePresence } from '../utils/presence'
import { getRoomsForConnection, isRoomMember, joinRoom, leaveRoom } from '../utils/room-registry'
import type { LockClaimPayload, LockReleasePayload, LockRoomSnapshot, PresenceJoinPayload } from '../../types'
import { devtoolsState, createEventLog, getConnectionSummaries, getStorageSnapshot, getLockSnapshot, getPresenceOverview, getRoomMembershipSnapshot, type DevtoolsEventType, type DevtoolsIoLike } from '../utils/devtools-state'

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

const EVENT_CHANNEL = 'nuxt-realtime:events'
const LEASE_PREFIX = '_lease:'

/**
 * Client-supplied storage keys must not reach into any internal namespace.
 *
 * Module state (`_lock:`, `_lockinfo:`, `_lockowner:`, `_ownerlocks:`, `_lockroom:`,
 * `_roomkeys:`, `_presence:`, `_connrooms:`, `_roommember:`, `_memberrooms:`,
 * `_roomcreated:`, `_roomclosing:`, `_conn:`, `_reclaiming:`, `_lease:`) shares the
 * `nuxt-realtime` mount with client-supplied keys, so the entire `_` prefix is reserved.
 *
 * Non-string keys are rejected here too: `storage:get` and `storage:set` run this check
 * outside their try/catch, so `key.startsWith` on a non-string would throw out of the
 * listener rather than returning an error to the caller.
 */
function isReservedKey(key: unknown): boolean {
  return typeof key !== 'string' || key.length === 0 || key.startsWith('_')
}

// Lock/presence/room keys are interpolated straight into storage keys (e.g. `_lock:${key}`),
// so a non-string payload (an object, a number, undefined) would silently collide unrelated
// locks/rooms instead of erroring. Guard the trust boundary the same way storage:set does.
function isValidKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isValidTtl(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

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

  // Rejecting a key is otherwise silent for subscribe (no ack) and indistinguishable from
  // "no value yet" for get, which makes a reserved key look like a sync bug. Warn in dev so
  // the cause is obvious at the call site. Dev-only on purpose: a client controls this string,
  // so warning in production would hand it a log-flooding primitive.
  const warnReservedKey = (op: string, key: unknown) => {
    if (!import.meta.dev) return
    logger.warn(`${op} rejected for reserved key ${JSON.stringify(key)}: keys starting with "_" are reserved for internal module state`)
  }

  const lockConfig = (config as { nuxtRealtime?: { lock?: { defaultTtl?: number, staleGraceMs?: number } } }).nuxtRealtime?.lock
  const staleGraceMs = lockConfig?.staleGraceMs ?? 10_000
  const defaultTtl = lockConfig?.defaultTtl

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
  let pubsub: PubSubDriver | null = null

  if (redisOpts) {
    const driverPath = 'nuxt-realtime/drivers/redis'
    const { reactiveRedisDriver, RealtimePubSub } = await import(driverPath)
    pubsub = new RealtimePubSub(redisOpts)
    const rootStorage = useStorage() as unknown as { mount: (base: string, driver: unknown) => void, unmount: (base: string) => Promise<void> }
    const redisBase = (redisOpts as { base?: string }).base ?? ''
    await rootStorage.unmount('nuxt-realtime')
    await rootStorage.unmount('_nuxt-realtime')
    rootStorage.mount('nuxt-realtime', reactiveRedisDriver({ ...redisOpts, pubsub, logger }))
    // Distinct Redis key prefix so module state and client keys cannot collide there either.
    // The pub/sub service is still shared, so the connection count stays at 2.
    rootStorage.mount('_nuxt-realtime', reactiveRedisDriver({ ...redisOpts, base: `${redisBase}_internal:`, pubsub, logger }))
  }

  // Client-facing: every key here is reachable via storage:get/storage:set by design.
  const storage = useStorage('nuxt-realtime')
  // Module state: locks, presence, room membership, connection records, leases.
  // Never addressable from a socket event.
  const internal = useStorage('_nuxt-realtime')
  const registry = createConnectionRegistry(internal, { staleGraceMs })

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
  let graceSweepIntervalId: ReturnType<typeof setInterval> | null = null

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
    if (graceSweepIntervalId !== null) {
      clearInterval(graceSweepIntervalId)
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

    // A client-supplied connectionId (see plugin.client.ts) survives reconnects, unlike
    // socket.id. It's the stable identity used for both lock ownership and presence
    // membership so a refresh/reconnect doesn't drop either. Opt-in: falls back to socket.id
    // when absent (in which case there's no reconnect-grace behavior, see disconnect below).
    let connectionId = socket.handshake?.auth?.connectionId as string | undefined
    if (connectionId !== undefined && !isValidKey(connectionId)) {
      connectionId = undefined
    }
    let identity = connectionId ?? socket.id

    // The identify/reclaim work below is async, but event listeners must be registered
    // synchronously on connection or events a client emits right after connecting (before this
    // resolves) would arrive with no listener and be silently dropped. Every handler below that
    // touches `identity`/`connectionId` awaits this first; it resolves near-instantly when no
    // connectionId was supplied.
    const identityReady = (async () => {
      if (!connectionId) return
      const identifyCtx = { connectionId, socket, info: {} as Record<string, unknown> }
      try {
        await nitroApp.hooks.callHook('nuxt-realtime:identify', identifyCtx)
      }
      catch (error) {
        logger.error('nuxt-realtime:identify hook failed:', error)
      }
      // A host app's identify hook can rebind connectionId to its own verified principal (e.g.
      // derived from a session/JWT) instead of the raw client-supplied value, so a spoofed
      // handshake connectionId can be rejected/replaced before it's used for anything.
      if (typeof identifyCtx.connectionId === 'string' && identifyCtx.connectionId.length > 0) {
        connectionId = identifyCtx.connectionId
      }
      const reclaimed = await registry.reclaim(connectionId, socket.id)
      if (!reclaimed) {
        // Either unclaimed (fresh id) or still owned by a different, live socket. In the
        // latter case registering over it would hijack that connection's identity, so treat
        // the supplied connectionId as unusable and fall back to socket.id instead.
        const existing = await registry.lookup(connectionId)
        if (existing) {
          logger.warn(`connectionId "${connectionId}" is already in use by an active connection; falling back to socket.id for this connection`)
          connectionId = undefined
        }
        else {
          await registry.register(connectionId, socket.id, identifyCtx.info)
        }
      }
      identity = connectionId ?? socket.id
    })()

    const ownedLocks = new Set<string>()
    // Only consulted when connectionId is absent (see disconnect below). When present, the
    // connection-registry grace-period sweep finds these via the storage-backed reverse index
    // in presence.ts/room-registry.ts instead, since that's what makes the sweep correct
    // across instances.
    const presenceRooms = new Set<string>()
    const joinedRooms = new Set<string>()

    // The single per-room auth checkpoint, shared by room:join, presence:join, and
    // lock:claim(room). A connection only ever passes nuxt-realtime:canJoinRoom once per
    // room, the first time it touches that room via any of the three. Returns whether the
    // caller is (or already was) a member.
    async function ensureRoomMembership(roomId: string): Promise<boolean> {
      await identityReady
      const alreadyMember = await isRoomMember(internal, roomId, identity)
      if (!alreadyMember) {
        const ctx = { roomId, connectionId: identity, socket, allow: true }
        try {
          await nitroApp.hooks.callHook('nuxt-realtime:canJoinRoom', ctx)
        }
        catch (error) {
          logger.error('nuxt-realtime:canJoinRoom hook failed:', error)
          // A registered hook that throws is a bug in the host app, not "no hook registered":
          // fail closed rather than silently falling through to the allow-by-default behavior.
          ctx.allow = false
        }
        if (!ctx.allow) return false

        const { firstMember } = await joinRoom(internal, roomId, identity)
        if (firstMember) {
          await nitroApp.hooks.callHook('nuxt-realtime:roomCreated', { roomId })
        }
      }
      // Always (re)join the Socket.IO room, even when storage already considered this identity
      // a member: Socket.IO room membership is per-socket and doesn't survive a reconnect, so a
      // reconnecting socket with the same identity still needs `socket.join` re-run against its
      // new socket instance, or it'll never actually receive this room's broadcasts.
      joinedRooms.add(roomId)
      socket.join(`room:${roomId}`)
      return true
    }

    // Storage operations
    socket.on('storage:get', async (key: string, callback) => {
      if (isReservedKey(key)) {
        warnReservedKey('storage:get', key)
        callback(null)
        return
      }
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
      if (isReservedKey(key)) {
        warnReservedKey('storage:set', key)
        if (callback) {
          callback({ success: false, error: 'Key is reserved for internal use' })
        }
        return
      }
      try {
        await storage.setItem(key, value)
        await touchLease(internal, key)
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
      if (isReservedKey(key)) {
        warnReservedKey('storage:subscribe', key)
        return
      }
      socket.join(`key:${key}`)
      record('storage:subscribe', socket.id, key)
      try {
        await touchLease(internal, key)
      }
      catch (error) {
        logger.error('Lease touch error on subscribe:', error)
      }
    })

    socket.on('storage:unsubscribe', (key: string) => {
      if (isReservedKey(key)) return
      socket.leave(`key:${key}`)
      record('storage:unsubscribe', socket.id, key)
    })

    socket.on('storage:heartbeat', async () => {
      try {
        // Touch leases for all keys this socket is subscribed to, plus any locks it holds
        const storageRooms = [...socket.rooms].filter(r => r.startsWith('key:'))
        await Promise.all([
          ...storageRooms.map(room => touchLease(internal, room.slice('key:'.length))),
          ...[...ownedLocks].map(key => touchLease(internal, `_lock:${key}`)),
        ])
      }
      catch (error) {
        logger.error('Heartbeat error:', error)
      }
    })

    // Lock operations
    socket.on('lock:claim', async ({ key, ownerInfo, room, ttl }: LockClaimPayload, callback) => {
      if (!isValidKey(key) || (room !== undefined && !isValidKey(room)) || !isValidTtl(ttl)) {
        if (callback) callback({ success: false, owned: false, error: 'Invalid lock:claim payload' })
        return
      }
      try {
        if (room && !(await ensureRoomMembership(room))) {
          if (callback) {
            callback({ success: false, owned: false, error: 'Not allowed to join this room' })
          }
          return
        }
        await identityReady
        const owned = await claimLock(internal, key, identity, ownerInfo, { room, ttl: ttl ?? defaultTtl })
        if (owned) {
          ownedLocks.add(key)
          const rooms = [`lock:${key}`]
          if (room) rooms.push(`lockroom:${room}`)
          socket.to(rooms).emit('lock:changed', { key, owner: identity, ownerInfo: ownerInfo ?? null, room })
          record('lock:claim', socket.id, key)
        }
        if (callback) {
          callback({ success: true, owned })
        }
      }
      catch (error) {
        logger.error('Lock claim error:', error)
        if (callback) {
          callback({ success: false, owned: false, error: 'Error while claiming lock' })
        }
      }
    })

    socket.on('lock:release', async ({ key, changed, meta }: LockReleasePayload, callback) => {
      if (!isValidKey(key)) {
        if (callback) callback({ success: false, error: 'Invalid lock:release payload' })
        return
      }
      try {
        await identityReady
        const room = await getLockRoom(internal, key)
        const released = await releaseLock(internal, key, identity)
        if (released) {
          ownedLocks.delete(key)
          const rooms = [`lock:${key}`]
          if (room) rooms.push(`lockroom:${room}`)
          socket.to(rooms).emit('lock:changed', { key, owner: null, changed: changed ?? false, meta, room: room ?? undefined })
          record('lock:release', socket.id, key)
        }
        if (callback) {
          callback({ success: released })
        }
      }
      catch (error) {
        logger.error('Lock release error:', error)
        if (callback) {
          callback({ success: false, error: 'Error while releasing lock' })
        }
      }
    })

    socket.on('lock:subscribe', async (key: string, callback) => {
      socket.join(`lock:${key}`)
      try {
        const owner = await getLockOwner(internal, key)
        const ownerInfo = owner ? await getLockOwnerInfo(internal, key) : null
        if (callback) {
          callback({ key, owner, ownerInfo })
        }
      }
      catch (error) {
        logger.error('Lock subscribe error:', error)
        if (callback) {
          callback({ key, owner: null, ownerInfo: null })
        }
      }
    })

    socket.on('lock:unsubscribe', (key: string) => {
      socket.leave(`lock:${key}`)
    })

    socket.on('lock:subscribeRoom', async (room: string, callback) => {
      try {
        // Same authorization checkpoint as the write paths (room:join, presence:join,
        // lock:claim(room)): without it any connected client could guess a room id and read
        // every lock's owner + ownerInfo in it, which commonly carries app user data.
        if (!isValidKey(room) || !(await ensureRoomMembership(room))) {
          if (callback) callback({})
          return
        }
        socket.join(`lockroom:${room}`)
        const keys = await getRoomKeys(internal, room)
        const snapshot: LockRoomSnapshot = {}
        for (const key of keys) {
          const owner = await getLockOwner(internal, key)
          if (owner) {
            snapshot[key] = { owner, ownerInfo: await getLockOwnerInfo(internal, key) }
          }
        }
        if (callback) callback(snapshot)
      }
      catch (error) {
        logger.error('Lock subscribeRoom error:', error)
        if (callback) callback({})
      }
    })

    socket.on('lock:unsubscribeRoom', (room: string) => {
      socket.leave(`lockroom:${room}`)
    })

    socket.on('lock:forceRelease', async ({ key }: { key: string }, callback) => {
      if (!isValidKey(key)) {
        if (callback) callback({ success: false, error: 'Invalid lock:forceRelease payload' })
        return
      }
      try {
        await identityReady
        const currentOwner = await getLockOwner(internal, key)
        const ctx = { key, connectionId: identity, currentOwner, allow: false }
        await nitroApp.hooks.callHook('nuxt-realtime:canForceRelease', ctx)

        if (currentOwner === null) {
          if (callback) callback({ success: false, error: 'Lock is not held' })
          return
        }
        if (!ctx.allow) {
          if (callback) callback({ success: false, error: 'Force-release is disabled' })
          return
        }

        const room = await getLockRoom(internal, key)
        const released = await releaseLock(internal, key, currentOwner)
        if (released) {
          const rooms = [`lock:${key}`]
          if (room) rooms.push(`lockroom:${room}`)
          io.to(rooms).emit('lock:changed', { key, owner: null, room: room ?? undefined })
          record('lock:forceRelease', socket.id, key)
        }
        if (callback) callback({ success: released })
      }
      catch (error) {
        logger.error('Lock force-release error:', error)
        if (callback) callback({ success: false, error: 'Error while force-releasing lock' })
      }
    })

    // Presence operations: "who's currently in room X", independent of whether they hold a
    // lock. Reuses the same opaque room string locks tag with; no new grouping concept.
    socket.on('presence:join', async ({ room, info }: PresenceJoinPayload, callback) => {
      if (!isValidKey(room)) {
        if (callback) callback({ success: false, error: 'Invalid presence:join payload' })
        return
      }
      try {
        if (!(await ensureRoomMembership(room))) {
          if (callback) callback({ success: false, error: 'Not allowed to join this room' })
          return
        }
        await joinPresence(internal, room, identity, info ?? null)
        presenceRooms.add(room)
        socket.join(`presence:${room}`)
        socket.to(`presence:${room}`).emit('presence:changed', { room, connectionId: identity, info: info ?? null })
        record('presence:join', socket.id, room)
        if (callback) callback({ success: true })
      }
      catch (error) {
        logger.error('Presence join error:', error)
        if (callback) callback({ success: false })
      }
    })

    socket.on('presence:leave', async ({ room }: { room: string }, callback) => {
      if (!isValidKey(room)) {
        if (callback) callback({ success: false, error: 'Invalid presence:leave payload' })
        return
      }
      try {
        await identityReady
        const existed = await leavePresence(internal, room, identity)
        presenceRooms.delete(room)
        socket.leave(`presence:${room}`)
        if (existed) {
          socket.to(`presence:${room}`).emit('presence:changed', { room, connectionId: identity, info: null })
          record('presence:leave', socket.id, room)
        }
        if (callback) callback({ success: true })
      }
      catch (error) {
        logger.error('Presence leave error:', error)
        if (callback) callback({ success: false })
      }
    })

    socket.on('presence:subscribeRoom', async (room: string, callback) => {
      try {
        // Same authorization checkpoint as the write paths: without it any connected client
        // could guess a room id and read every member's id + info, which commonly carries app
        // user data.
        if (!isValidKey(room) || !(await ensureRoomMembership(room))) {
          if (callback) callback({})
          return
        }
        socket.join(`presence:${room}`)
        const snapshot = await getPresenceSnapshot(internal, room)
        if (callback) callback(snapshot)
      }
      catch (error) {
        logger.error('Presence subscribeRoom error:', error)
        if (callback) callback({})
      }
    })

    // Room membership: the explicit version of what presence:join/lock:claim(room) already
    // do implicitly via ensureRoomMembership. Scopes state/events client-side (see
    // useRealtimeRoom); server-side it's purely membership + lifecycle hooks + auth.
    socket.on('room:join', async (roomId: string, callback) => {
      if (!isValidKey(roomId)) {
        if (callback) callback({ success: false, error: 'Invalid room:join payload' })
        return
      }
      try {
        const allowed = await ensureRoomMembership(roomId)
        if (allowed) {
          record('room:join', socket.id, roomId)
        }
        if (callback) {
          callback(allowed ? { success: true } : { success: false, error: 'Not allowed to join this room' })
        }
      }
      catch (error) {
        logger.error('Room join error:', error)
        if (callback) callback({ success: false, error: 'Error while joining room' })
      }
    })

    socket.on('room:leave', async (roomId: string, callback) => {
      if (!isValidKey(roomId)) {
        if (callback) callback({ success: false, error: 'Invalid room:leave payload' })
        return
      }
      try {
        await identityReady
        const { left, nowEmpty } = await leaveRoom(internal, roomId, identity)
        joinedRooms.delete(roomId)
        socket.leave(`room:${roomId}`)
        if (left) {
          record('room:leave', socket.id, roomId)
        }
        if (left && nowEmpty) {
          await nitroApp.hooks.callHook('nuxt-realtime:roomEmpty', { roomId })
        }
        if (callback) callback({ success: true })
      }
      catch (error) {
        logger.error('Room leave error:', error)
        if (callback) callback({ success: false, error: 'Error while leaving room' })
      }
    })

    socket.on('disconnect', async () => {
      try {
        await identityReady
        if (connectionId) {
          // Give the client a grace period to reconnect with the same connectionId before
          // releasing anything. The periodic sweep below does the actual release once the
          // grace period lapses without a reclaim (see createConnectionRegistry). That sweep
          // also leaves presence/room-membership in every room this connection was part of
          // (via the storage-backed reverse indexes in presence.ts/room-registry.ts), so
          // nothing to do here for presence/rooms.
          await registry.markStale(connectionId, socket.id)
          return
        }
        await Promise.all([...ownedLocks].map(async (key) => {
          const room = await getLockRoom(internal, key)
          const released = await releaseLock(internal, key, socket.id)
          if (released) {
            const rooms = [`lock:${key}`]
            if (room) rooms.push(`lockroom:${room}`)
            socket.to(rooms).emit('lock:changed', { key, owner: null, room: room ?? undefined })
          }
        }))
        await Promise.all([...presenceRooms].map(async (room) => {
          const existed = await leavePresence(internal, room, socket.id)
          if (existed) {
            socket.to(`presence:${room}`).emit('presence:changed', { room, connectionId: socket.id, info: null })
          }
        }))
        await Promise.all([...joinedRooms].map(async (roomId) => {
          const { left, nowEmpty } = await leaveRoom(internal, roomId, socket.id)
          if (left && nowEmpty) {
            await nitroApp.hooks.callHook('nuxt-realtime:roomEmpty', { roomId })
          }
        }))
      }
      catch (error) {
        logger.error('Lock/presence/room release on disconnect error:', error)
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

  // One-time migration. Up to 0.2.x module state lived in the client-facing mount, so an
  // upgraded deployment can still have `_lock:`/`_conn:`/`_roommember:` keys sitting in
  // `nuxt-realtime` where clients can read them and the devtools storage panel lists them.
  // All of it is ephemeral session state, so dropping it is safe; client keys are untouched.
  try {
    const staleInternalKeys = (await storage.getKeys()).filter(k => k.startsWith('_'))
    if (staleInternalKeys.length > 0) {
      await Promise.all(staleInternalKeys.map(k => storage.removeItem(k)))
      logger.info(`Removed ${staleInternalKeys.length} pre-0.3 internal key(s) from the client storage mount`)
    }
  }
  catch (error) {
    logger.error('Internal key migration sweep failed:', error)
  }

  // Cleanup job
  if (cleanupConfig) {
    const { cleanupInterval, idleThreshold } = cleanupConfig

    // Add jitter (±10%) so multiple servers don't all scan at the same instant
    const jitter = cleanupInterval * 0.1
    const interval = cleanupInterval + Math.random() * jitter * 2 - jitter

    cleanupIntervalId = setInterval(async () => {
      try {
        const leaseKeys = (await internal.getKeys()).filter(k => k.startsWith(LEASE_PREFIX))

        for (const leaseKey of leaseKeys) {
          const lease = await internal.getItem<{ lastSeen: number }>(leaseKey)
          if (!lease || Date.now() - lease.lastSeen <= idleThreshold) continue

          const dataKey = leaseKey.slice(LEASE_PREFIX.length)
          await internal.removeItem(leaseKey)

          // A `_lock:` lease guards module state, not a client key. Removing the raw key left
          // _lockinfo:/_lockowner:/_ownerlocks:/_lockroom:/_roomkeys: orphaned forever and told
          // nobody, so the holder kept reporting ownedByMe while another client could claim the
          // same lock. Go through releaseLock and broadcast, exactly like the grace sweep.
          if (dataKey.startsWith('_lock:')) {
            const key = dataKey.slice('_lock:'.length)
            const owner = await getLockOwner(internal, key)
            if (owner) {
              const room = await getLockRoom(internal, key)
              const released = await releaseLock(internal, key, owner)
              if (released) {
                const rooms = [`lock:${key}`]
                if (room) rooms.push(`lockroom:${room}`)
                io.to(rooms).emit('lock:changed', { key, owner: null, room: room ?? undefined })
              }
            }
            logger.debug(`Cleaned up idle lock: ${key}`)
            continue
          }

          await storage.removeItem(dataKey)
          logger.debug(`Cleaned up idle key: ${dataKey}`)
        }
      }
      catch (error) {
        logger.error('Cleanup job error:', error)
      }
    }, interval)
  }

  // Connection-registry grace-period sweep. Deliberately separate from the cleanup job above:
  // that one defaults to a 5-minute cadence (fine for idle keys), while a stale-connection
  // grace period is typically ~10s and needs a much tighter check interval to mean anything.
  // Storage-backed and poll-based (no in-memory setTimeout) so it works correctly regardless
  // of which server instance saw the disconnect vs. which one sees the reconnect, and survives
  // a server restart mid-grace-period (a fresh process just resumes sweeping).
  {
    const sweepInterval = Math.max(1000, staleGraceMs / 3)
    const jitter = sweepInterval * 0.1
    const interval = sweepInterval + Math.random() * jitter * 2 - jitter

    graceSweepIntervalId = setInterval(async () => {
      try {
        for (const connectionId of await registry.listIds()) {
          const record = await registry.lookup(connectionId)
          if (!record || !registry.isGraceExpired(record)) continue

          const keys = await getLocksOwnedBy(internal, connectionId)
          await Promise.all(keys.map(async (key) => {
            const room = await getLockRoom(internal, key)
            const released = await releaseLock(internal, key, connectionId)
            if (released) {
              const rooms = [`lock:${key}`]
              if (room) rooms.push(`lockroom:${room}`)
              io.to(rooms).emit('lock:changed', { key, owner: null, room: room ?? undefined })
            }
          }))

          const presenceRoomsHeld = await getPresenceRoomsForConnection(internal, connectionId)
          await Promise.all(presenceRoomsHeld.map(async (room) => {
            const existed = await leavePresence(internal, room, connectionId)
            if (existed) {
              io.to(`presence:${room}`).emit('presence:changed', { room, connectionId, info: null })
            }
          }))

          const memberOfRooms = await getRoomsForConnection(internal, connectionId)
          await Promise.all(memberOfRooms.map(async (roomId) => {
            const { left, nowEmpty } = await leaveRoom(internal, roomId, connectionId)
            if (left && nowEmpty) {
              await nitroApp.hooks.callHook('nuxt-realtime:roomEmpty', { roomId })
            }
          }))

          // Re-check right before removing: releasing the locks/presence/rooms above (a full
          // key scan plus N releases) takes long enough that a reconnect could have reclaimed this
          // connectionId in the meantime. Removing unconditionally would wipe out that fresh
          // reclaim, and since markStale() is a no-op on a missing record, a later disconnect
          // would never re-enter the grace period, so those locks would then never be released.
          const stillExpired = await registry.lookup(connectionId)
          if (stillExpired && registry.isGraceExpired(stillExpired)) {
            await registry.remove(connectionId)
          }
        }
      }
      catch (error) {
        logger.error('Connection grace-period sweep error:', error)
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
  // `devtoolsEnabled` comes from *public* runtime config, so it is overridable at runtime
  // (NUXT_PUBLIC_NUXT_REALTIME_DEVTOOLS_ENABLED=true). This endpoint dumps every storage key
  // and value, all connections, and all lock owner info, so gate it on the build-time dev
  // flag as well and let the config option only ever turn it off.
  if (devtoolsEnabled && import.meta.dev) {
    nitroApp.router.use('/__nuxt-realtime__/devtools', defineEventHandler(async (event) => {
      const query = getQuery(event)
      switch (query.type) {
        case 'connections':
          return getConnectionSummaries(devtoolsState.io!)
        case 'storage':
          return getStorageSnapshot(storage, devtoolsState.io!)
        case 'locks':
          return getLockSnapshot(internal)
        case 'presence':
          return getPresenceOverview(internal, await registry.listIds())
        case 'roomMembers':
          return getRoomMembershipSnapshot(internal, await registry.listIds())
        case 'events':
          return devtoolsState.eventLog.list(query.sinceId ? Number(query.sinceId) : undefined)
        default:
          throw createError({ statusCode: 400, statusMessage: 'nuxt-realtime devtools: unknown query type' })
      }
    }))
  }
})
