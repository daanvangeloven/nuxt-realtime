import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

describe('serverOptions passthrough', () => {
  const serverOptions = {
    cors: { origin: ['https://myapp.com'], credentials: true },
    maxHttpBufferSize: 1e6,
  }

  let EngineMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()

    EngineMock = vi.fn()

    vi.doMock('engine.io', () => ({ Server: EngineMock }))

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    vi.doMock('h3', () => ({
      defineEventHandler: vi.fn().mockReturnValue({}),
    }))

    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: false,
            logging: { level: null, format: 'text' },
          },
        },
        nuxtRealtime: {
          socketio: { serverOptions },
        },
      }),
      useStorage: () => ({
        watch: vi.fn().mockResolvedValue(vi.fn()),
        setItem: vi.fn(),
        getItem: vi.fn(),
        getKeys: vi.fn().mockResolvedValue([]),
        removeItem: vi.fn(),
      }),
    }))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('passes nuxtRealtime.socketio.serverOptions to the Engine constructor', async () => {
    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(EngineMock).toHaveBeenCalledWith(
      expect.objectContaining(serverOptions),
    )
  })
})

describe('custom socketio.path', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.doMock('engine.io', () => ({ Server: vi.fn() }))

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    vi.doMock('h3', () => ({
      defineEventHandler: vi.fn().mockReturnValue({}),
    }))

    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: false,
            logging: { level: null, format: 'text' },
          },
        },
        nuxtRealtime: {
          socketio: { path: '/ws' },
        },
      }),
      useStorage: () => ({
        watch: vi.fn().mockResolvedValue(vi.fn()),
        setItem: vi.fn(),
        getItem: vi.fn(),
        getKeys: vi.fn().mockResolvedValue([]),
        removeItem: vi.fn(),
      }),
    }))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('registers the router at the configured path instead of the hardcoded default', async () => {
    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(nitroApp.router.use).toHaveBeenCalledWith('/ws/', expect.anything())
    expect(nitroApp.router.use).not.toHaveBeenCalledWith('/socket.io/', expect.anything())
  })
})

describe('default socketio path', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.doMock('engine.io', () => ({ Server: vi.fn() }))

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    vi.doMock('h3', () => ({
      defineEventHandler: vi.fn().mockReturnValue({}),
    }))

    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: false,
            logging: { level: null, format: 'text' },
          },
        },
        nuxtRealtime: {},
      }),
      useStorage: () => ({
        watch: vi.fn().mockResolvedValue(vi.fn()),
        setItem: vi.fn(),
        getItem: vi.fn(),
        getKeys: vi.fn().mockResolvedValue([]),
        removeItem: vi.fn(),
      }),
    }))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('registers the router at /socket.io/ when no path is configured', async () => {
    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(nitroApp.router.use).toHaveBeenCalledWith('/socket.io/', expect.anything())
  })
})

describe('nuxt-realtime:io hook', () => {
  let EngineMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()

    EngineMock = vi.fn()

    vi.doMock('engine.io', () => ({ Server: EngineMock }))

    vi.doMock('h3', () => ({
      defineEventHandler: vi.fn().mockReturnValue({}),
    }))

    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: false,
            logging: { level: null, format: 'text' },
          },
        },
        nuxtRealtime: {},
      }),
      useStorage: () => ({
        watch: vi.fn().mockResolvedValue(vi.fn()),
        setItem: vi.fn(),
        getItem: vi.fn(),
        getKeys: vi.fn().mockResolvedValue([]),
        removeItem: vi.fn(),
      }),
    }))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('calls the nuxt-realtime:io hook with the io instance before io.bind()', async () => {
    const order: string[] = []

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn(() => order.push('bind'))
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: {
        hook: vi.fn(),
        callHook: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'nuxt-realtime:io') order.push('hook')
        }),
      },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(order.indexOf('hook')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('bind')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('hook')).toBeLessThan(order.indexOf('bind'))
  })

  it('passes the io instance to the hook callback', async () => {
    let capturedIo: unknown

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: {
        hook: vi.fn(),
        callHook: vi.fn().mockImplementation(async (_name: string, io: unknown) => {
          capturedIo = io
        }),
      },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(capturedIo).toBeDefined()
  })
})

describe('nuxt-realtime:io hook: middleware runs before connection', () => {
  it('middleware registered via io.use() executes before the connection handler', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)

    // Simulate what a consumer does in their hook callback
    io.use((socket, next) => {
      socket.data.fromMiddleware = true
      next()
    })

    const middlewareRanBeforeConnection = new Promise<boolean>((resolve) => {
      io.on('connection', (socket) => {
        resolve(socket.data.fromMiddleware === true)
      })
    })

    const port = await new Promise<number>(resolve =>
      httpServer.listen(0, () => resolve((httpServer.address() as AddressInfo).port)),
    )

    const client = await connectClient(port)
    try {
      await expect(middlewareRanBeforeConnection).resolves.toBe(true)
    }
    finally {
      client.close()
      io.close()
      await new Promise<void>(resolve => httpServer.close(() => resolve()))
    }
  })
})

// Re-implements the server-side cleanup logic from socketio.ts in a self-contained way
// so it can be tested without Nitro/unstorage dependencies.
function createTestServer() {
  const storage = new Map<string, unknown>()

  function touchLease(key: string) {
    storage.set(`_lease:${key}`, { lastSeen: Date.now() })
  }

  const httpServer = createServer()
  const io = new Server(httpServer)

  io.on('connection', (socket) => {
    const ownedLocks = new Set<string>()

    socket.on('storage:get', (key: string, callback) => {
      callback(storage.get(key) ?? null)
    })

    socket.on('storage:set', ({ key, value }, callback) => {
      storage.set(key, value)
      touchLease(key)
      socket.to(`key:${key}`).emit('storage:updated', { key, value })
      if (callback) callback({ success: true, status: 'ok' })
    })

    socket.on('storage:subscribe', (key: string, callback?: () => void) => {
      socket.join(`key:${key}`)
      touchLease(key)
      callback?.()
    })

    socket.on('storage:unsubscribe', (key: string) => {
      socket.leave(`key:${key}`)
    })

    socket.on('storage:heartbeat', (callback?: () => void) => {
      const storageRooms = [...socket.rooms].filter(r => r.startsWith('key:'))
      storageRooms.forEach(room => touchLease(room.slice(4)))
      ownedLocks.forEach(key => touchLease(`_lock:${key}`))
      callback?.()
    })

    // Lock operations — mirrors the claimLock/releaseLock fallback logic from lock.ts,
    // re-implemented against the plain Map so this stays self-contained like the rest of the file.
    socket.on('lock:claim', (
      { key, ownerInfo }: { key: string, ownerInfo?: unknown },
      callback?: (response: { success: boolean, owned: boolean }) => void,
    ) => {
      const lockKey = `_lock:${key}`
      const current = storage.get(lockKey) as { owner: string } | undefined
      const owned = !current || current.owner === socket.id
      if (owned) {
        storage.set(lockKey, { owner: socket.id })
        storage.set(`_lockinfo:${key}`, ownerInfo ?? null)
        touchLease(lockKey)
        ownedLocks.add(key)
        socket.to(`lock:${key}`).emit('lock:changed', { key, owner: socket.id, ownerInfo: ownerInfo ?? null })
      }
      callback?.({ success: true, owned })
    })

    socket.on('lock:release', (
      { key, changed }: { key: string, changed?: boolean },
      callback?: (response: { success: boolean }) => void,
    ) => {
      const lockKey = `_lock:${key}`
      const current = storage.get(lockKey) as { owner: string } | undefined
      const released = current?.owner === socket.id
      if (released) {
        storage.delete(lockKey)
        storage.delete(`_lockinfo:${key}`)
        ownedLocks.delete(key)
        socket.to(`lock:${key}`).emit('lock:changed', { key, owner: null, changed: changed ?? false })
      }
      callback?.({ success: released })
    })

    socket.on('lock:subscribe', (key: string, callback?: (state: { key: string, owner: string | null, ownerInfo: unknown }) => void) => {
      socket.join(`lock:${key}`)
      const current = storage.get(`_lock:${key}`) as { owner: string } | undefined
      const ownerInfo = current ? (storage.get(`_lockinfo:${key}`) ?? null) : null
      callback?.({ key, owner: current?.owner ?? null, ownerInfo })
    })

    socket.on('lock:unsubscribe', (key: string) => {
      socket.leave(`lock:${key}`)
    })

    // Releases any locks still held when the socket goes away — mirrors the disconnect
    // handler in socketio.ts.
    socket.on('disconnect', () => {
      ownedLocks.forEach((key) => {
        storage.delete(`_lock:${key}`)
        storage.delete(`_lockname:${key}`)
        socket.to(`lock:${key}`).emit('lock:changed', { key, owner: null })
      })
      ownedLocks.clear()
    })
  })

  // Exposed directly so tests can trigger cleanup without relying on setInterval timing
  function runCleanup(idleThreshold: number) {
    for (const [key] of storage) {
      if (!key.startsWith('_lease:')) continue
      const lease = storage.get(key) as { lastSeen: number }
      if (Date.now() - lease.lastSeen > idleThreshold) {
        const dataKey = key.slice('_lease:'.length)
        storage.delete(key)
        storage.delete(dataKey)
      }
    }
  }

  return { io, httpServer, storage, runCleanup }
}

async function connectClient(port: number): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`)
  await new Promise<void>(resolve => socket.on('connect', resolve))
  return socket
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('cleanup - lease creation', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let storage: Map<string, unknown>
  let client: ClientSocket
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer, storage } = createTestServer())
    await new Promise<void>(resolve => httpServer.listen(0, () => {
      serverPort = (httpServer.address() as AddressInfo).port
      resolve()
    }))
    client = await connectClient(serverPort)
  })

  afterEach(async () => {
    client.close()
    io.close()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  })

  it('creates a lease when subscribing to a key', async () => {
    client.emit('storage:subscribe', 'room:session-abc')
    await wait(50)

    expect(storage.has('_lease:room:session-abc')).toBe(true)
    const lease = storage.get('_lease:room:session-abc') as { lastSeen: number }
    expect(lease.lastSeen).toBeCloseTo(Date.now(), -3)
  })

  it('creates a lease when setting a key', async () => {
    client.emit('storage:set', { key: 'room:session-def', value: { users: [] } })
    await wait(50)

    expect(storage.has('_lease:room:session-def')).toBe(true)
  })

  it('updates lastSeen on storage:set', async () => {
    client.emit('storage:subscribe', 'room:session-abc')
    await wait(50)

    const firstSeen = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen

    await wait(20)
    client.emit('storage:set', { key: 'room:session-abc', value: { users: [] } })
    await wait(50)

    const updatedSeen = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen
    expect(updatedSeen).toBeGreaterThan(firstSeen)
  })
})

describe('cleanup - heartbeat', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let storage: Map<string, unknown>
  let client: ClientSocket
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer, storage } = createTestServer())
    await new Promise<void>(resolve => httpServer.listen(0, () => {
      serverPort = (httpServer.address() as AddressInfo).port
      resolve()
    }))
    client = await connectClient(serverPort)
  })

  afterEach(async () => {
    client.close()
    io.close()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  })

  it('refreshes lease for all subscribed keys on heartbeat', async () => {
    await Promise.all([
      new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-1', resolve)),
      new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-2', resolve)),
    ])

    const firstSeen1 = (storage.get('_lease:room:session-1') as { lastSeen: number }).lastSeen
    const firstSeen2 = (storage.get('_lease:room:session-2') as { lastSeen: number }).lastSeen

    // Record the timestamp just before the heartbeat so we have a reliable lower bound
    // regardless of clock resolution. The ack ensures the handler has fully run.
    const beforeHeartbeat = Date.now()
    await new Promise<void>(resolve => client.emit('storage:heartbeat', resolve))

    expect((storage.get('_lease:room:session-1') as { lastSeen: number }).lastSeen).toBeGreaterThanOrEqual(beforeHeartbeat)
    expect((storage.get('_lease:room:session-2') as { lastSeen: number }).lastSeen).toBeGreaterThanOrEqual(beforeHeartbeat)
    expect((storage.get('_lease:room:session-1') as { lastSeen: number }).lastSeen).toBeGreaterThanOrEqual(firstSeen1)
    expect((storage.get('_lease:room:session-2') as { lastSeen: number }).lastSeen).toBeGreaterThanOrEqual(firstSeen2)
  })

  it('does not refresh leases for keys the client is not subscribed to', async () => {
    // Set a key manually without subscribing
    storage.set('room:session-other', { users: [] })
    storage.set('_lease:room:session-other', { lastSeen: Date.now() })

    const leaseBefore = (storage.get('_lease:room:session-other') as { lastSeen: number }).lastSeen

    await new Promise<void>(resolve => client.emit('storage:heartbeat', resolve))

    const leaseAfter = (storage.get('_lease:room:session-other') as { lastSeen: number }).lastSeen
    expect(leaseAfter).toBe(leaseBefore)
  })

  it('does not refresh lease for unsubscribed key', async () => {
    await new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-abc', resolve))

    client.emit('storage:unsubscribe', 'room:session-abc')
    await wait(30)

    const leaseBefore = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen

    await new Promise<void>(resolve => client.emit('storage:heartbeat', resolve))

    const leaseAfter = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen
    expect(leaseAfter).toBe(leaseBefore)
  })
})

describe('cleanup - job', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let storage: Map<string, unknown>
  let runCleanup: (idleThreshold: number) => void
  let client: ClientSocket
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer, storage, runCleanup } = createTestServer())
    await new Promise<void>(resolve => httpServer.listen(0, () => {
      serverPort = (httpServer.address() as AddressInfo).port
      resolve()
    }))
    client = await connectClient(serverPort)
  })

  afterEach(async () => {
    client.close()
    io.close()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  })

  it('removes stale data key and lease key after idle threshold', async () => {
    client.emit('storage:subscribe', 'room:session-abc')
    // Use ack to guarantee the server has processed storage:set before we assert
    await new Promise<void>(resolve =>
      client.emit('storage:set', { key: 'room:session-abc', value: { users: [] } }, resolve),
    )

    expect(storage.has('room:session-abc')).toBe(true)
    expect(storage.has('_lease:room:session-abc')).toBe(true)

    // Wait past idle threshold then run cleanup
    await wait(100)
    runCleanup(50) // lease is now stale

    expect(storage.has('room:session-abc')).toBe(false)
    expect(storage.has('_lease:room:session-abc')).toBe(false)
  })

  it('does not remove keys that are within the idle threshold', async () => {
    await new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-abc', resolve))
    await new Promise<void>(resolve =>
      client.emit('storage:set', { key: 'room:session-abc', value: { users: [] } }, resolve),
    )

    runCleanup(10_000)

    expect(storage.has('room:session-abc')).toBe(true)
    expect(storage.has('_lease:room:session-abc')).toBe(true)
  })

  it('keeps keys alive when client sends heartbeats', async () => {
    await new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-abc', resolve))
    await new Promise<void>(resolve =>
      client.emit('storage:set', { key: 'room:session-abc', value: { users: [] } }, resolve),
    )

    await new Promise<void>(resolve => client.emit('storage:heartbeat', resolve))
    runCleanup(50)

    expect(storage.has('room:session-abc')).toBe(true)
    expect(storage.has('_lease:room:session-abc')).toBe(true)
  })

  it('cleans up multiple stale keys in one pass', async () => {
    client.emit('storage:set', { key: 'room:session-1', value: { users: [] } })
    client.emit('storage:set', { key: 'room:session-2', value: { users: [] } })
    client.emit('storage:set', { key: 'room:session-3', value: { users: [] } })
    await wait(100)

    runCleanup(50)

    expect(storage.has('room:session-1')).toBe(false)
    expect(storage.has('room:session-2')).toBe(false)
    expect(storage.has('room:session-3')).toBe(false)
    expect(storage.has('_lease:room:session-1')).toBe(false)
    expect(storage.has('_lease:room:session-2')).toBe(false)
    expect(storage.has('_lease:room:session-3')).toBe(false)
  })

  it('only cleans up keys with a lease, leaves unmanaged keys alone', async () => {
    // Manually insert a key with no lease (e.g. seeded data)
    storage.set('config:feature-flags', { enabled: true })
    await wait(100)

    runCleanup(50)

    expect(storage.has('config:feature-flags')).toBe(true)
  })
})

describe('lock handlers', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let storage: Map<string, unknown>
  let clientA: ClientSocket
  let clientB: ClientSocket
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer, storage } = createTestServer())
    await new Promise<void>(resolve => httpServer.listen(0, () => {
      serverPort = (httpServer.address() as AddressInfo).port
      resolve()
    }))
    clientA = await connectClient(serverPort)
    clientB = await connectClient(serverPort)
  })

  afterEach(async () => {
    clientA.close()
    clientB.close()
    io.close()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  })

  it('claim succeeds and reports owned:true when the lock is free', async () => {
    const response = await new Promise<{ success: boolean, owned: boolean }>(resolve =>
      clientA.emit('lock:claim', { key: 'doc-1' }, resolve),
    )

    expect(response).toEqual({ success: true, owned: true })
    expect(storage.get('_lock:doc-1')).toEqual({ owner: clientA.id })
  })

  it('claim by the same client is idempotent', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    const response = await new Promise<{ success: boolean, owned: boolean }>(resolve =>
      clientA.emit('lock:claim', { key: 'doc-1' }, resolve),
    )

    expect(response.owned).toBe(true)
  })

  it('claim by another client fails while the lock is held', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    const response = await new Promise<{ success: boolean, owned: boolean }>(resolve =>
      clientB.emit('lock:claim', { key: 'doc-1' }, resolve),
    )

    expect(response).toEqual({ success: true, owned: false })
    expect(storage.get('_lock:doc-1')).toEqual({ owner: clientA.id })
  })

  it('release by a non-owner fails and leaves the lock held', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    const response = await new Promise<{ success: boolean }>(resolve =>
      clientB.emit('lock:release', { key: 'doc-1' }, resolve),
    )

    expect(response).toEqual({ success: false })
    expect(storage.get('_lock:doc-1')).toEqual({ owner: clientA.id })
  })

  it('release by the owner succeeds and frees the lock for others', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    const releaseResponse = await new Promise<{ success: boolean }>(resolve =>
      clientA.emit('lock:release', { key: 'doc-1' }, resolve),
    )
    expect(releaseResponse).toEqual({ success: true })
    expect(storage.has('_lock:doc-1')).toBe(false)

    const claimResponse = await new Promise<{ success: boolean, owned: boolean }>(resolve =>
      clientB.emit('lock:claim', { key: 'doc-1' }, resolve),
    )
    expect(claimResponse).toEqual({ success: true, owned: true })
  })

  it('broadcasts lock:changed to subscribers when a lock is claimed', async () => {
    await new Promise<void>(resolve => clientB.emit('lock:subscribe', 'doc-1', () => resolve()))

    const received: unknown[] = []
    clientB.on('lock:changed', data => received.push(data))

    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    await wait(30)

    expect(received).toEqual([{ key: 'doc-1', owner: clientA.id, ownerInfo: null }])
  })

  it('broadcasts the owner info passed to claim, and returns it via subscribe', async () => {
    const received: unknown[] = []
    clientB.on('lock:changed', data => received.push(data))
    await new Promise<void>(resolve => clientB.emit('lock:subscribe', 'doc-1', () => resolve()))

    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1', ownerInfo: 'Alice' }, () => resolve()))
    await wait(30)

    expect(received).toEqual([{ key: 'doc-1', owner: clientA.id, ownerInfo: 'Alice' }])

    const state = await new Promise<{ key: string, owner: string | null, ownerInfo: unknown }>(resolve =>
      clientB.emit('lock:subscribe', 'doc-1', resolve),
    )
    expect(state).toEqual({ key: 'doc-1', owner: clientA.id, ownerInfo: 'Alice' })
  })

  it('round-trips an arbitrary JSON-serializable owner info shape', async () => {
    const aliceInfo = { name: 'Alice', avatarUrl: '/alice.png' }
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1', ownerInfo: aliceInfo }, () => resolve()))

    const state = await new Promise<{ key: string, owner: string | null, ownerInfo: unknown }>(resolve =>
      clientB.emit('lock:subscribe', 'doc-1', resolve),
    )
    expect(state).toEqual({ key: 'doc-1', owner: clientA.id, ownerInfo: aliceInfo })
  })

  it('broadcasts lock:changed with a null owner when a lock is released', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    await new Promise<void>(resolve => clientB.emit('lock:subscribe', 'doc-1', () => resolve()))

    const received: unknown[] = []
    clientB.on('lock:changed', data => received.push(data))

    await new Promise<void>(resolve => clientA.emit('lock:release', { key: 'doc-1' }, () => resolve()))
    await wait(30)

    expect(received).toEqual([{ key: 'doc-1', owner: null, changed: false }])
  })

  it('forwards changed:true from release to the lock:changed broadcast', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    await new Promise<void>(resolve => clientB.emit('lock:subscribe', 'doc-1', () => resolve()))

    const received: unknown[] = []
    clientB.on('lock:changed', data => received.push(data))

    await new Promise<void>(resolve => clientA.emit('lock:release', { key: 'doc-1', changed: true }, () => resolve()))
    await wait(30)

    expect(received).toEqual([{ key: 'doc-1', owner: null, changed: true }])
  })

  it('subscribe returns the current owner without side effects', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))

    const state = await new Promise<{ key: string, owner: string | null }>(resolve =>
      clientB.emit('lock:subscribe', 'doc-1', resolve),
    )

    expect(state).toEqual({ key: 'doc-1', owner: clientA.id, ownerInfo: null })
    // Subscribing must not have claimed the lock for clientB
    expect(storage.get('_lock:doc-1')).toEqual({ owner: clientA.id })
  })

  it('subscribe reports owner:null for a lock that has never been claimed', async () => {
    const state = await new Promise<{ key: string, owner: string | null }>(resolve =>
      clientB.emit('lock:subscribe', 'never-claimed', resolve),
    )

    expect(state).toEqual({ key: 'never-claimed', owner: null, ownerInfo: null })
  })

  it('refreshes the lock lease on heartbeat so a held lock is not reaped as idle', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    const firstSeen = (storage.get('_lease:_lock:doc-1') as { lastSeen: number }).lastSeen

    const beforeHeartbeat = Date.now()
    await new Promise<void>(resolve => clientA.emit('storage:heartbeat', resolve))

    expect((storage.get('_lease:_lock:doc-1') as { lastSeen: number }).lastSeen).toBeGreaterThanOrEqual(beforeHeartbeat)
    expect((storage.get('_lease:_lock:doc-1') as { lastSeen: number }).lastSeen).toBeGreaterThanOrEqual(firstSeen)
  })

  it('does not refresh lock leases for locks this client does not own', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    const leaseBefore = (storage.get('_lease:_lock:doc-1') as { lastSeen: number }).lastSeen

    await new Promise<void>(resolve => clientB.emit('storage:heartbeat', resolve))

    expect((storage.get('_lease:_lock:doc-1') as { lastSeen: number }).lastSeen).toBe(leaseBefore)
  })

  it('releases a held lock and notifies subscribers when the owner disconnects', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:claim', { key: 'doc-1' }, () => resolve()))
    await new Promise<void>(resolve => clientB.emit('lock:subscribe', 'doc-1', () => resolve()))

    const received: unknown[] = []
    clientB.on('lock:changed', data => received.push(data))

    clientA.close()
    await wait(30)

    expect(storage.has('_lock:doc-1')).toBe(false)
    expect(received).toEqual([{ key: 'doc-1', owner: null }])

    const claimResponse = await new Promise<{ success: boolean, owned: boolean }>(resolve =>
      clientB.emit('lock:claim', { key: 'doc-1' }, resolve),
    )
    expect(claimResponse).toEqual({ success: true, owned: true })
  })

  it('does not touch storage on disconnect when the client owns no locks', async () => {
    await new Promise<void>(resolve => clientA.emit('lock:subscribe', 'doc-1', () => resolve()))

    clientA.close()
    await wait(30)

    expect(storage.has('_lock:doc-1')).toBe(false)
  })
})

describe('storage handlers reject reserved _lease: keys', () => {
  let storageMock: {
    watch: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    getItem: ReturnType<typeof vi.fn>
    getKeys: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
  }
  let connectionHandler: ((socket: unknown) => void) | undefined
  let handlers: Record<string, (...args: unknown[]) => unknown>
  let fakeSocket: { join: ReturnType<typeof vi.fn>, leave: ReturnType<typeof vi.fn>, to: ReturnType<typeof vi.fn>, on: ReturnType<typeof vi.fn>, rooms: Set<string>, id: string }

  beforeEach(async () => {
    vi.resetModules()

    storageMock = {
      watch: vi.fn().mockResolvedValue(vi.fn()),
      setItem: vi.fn(),
      getItem: vi.fn(),
      getKeys: vi.fn().mockResolvedValue([]),
      removeItem: vi.fn(),
    }

    vi.doMock('engine.io', () => ({ Server: vi.fn() }))

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn((event: string, cb: (socket: unknown) => void) => {
        if (event === 'connection') connectionHandler = cb
      })
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    vi.doMock('h3', () => ({
      defineEventHandler: vi.fn().mockReturnValue({}),
      getQuery: vi.fn(() => ({})),
      createError: vi.fn((opts: { statusMessage: string }) => new Error(opts.statusMessage)),
    }))

    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: false,
            logging: { level: null, format: 'text' },
            devtoolsEnabled: false,
          },
        },
        nuxtRealtime: {},
      }),
      useStorage: () => storageMock,
    }))

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    handlers = {}
    fakeSocket = {
      id: 'socket-abc',
      rooms: new Set(['socket-abc']),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers[event] = handler
      }),
    }
    connectionHandler!(fakeSocket)
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('storage:get ignores a _lease:-prefixed key and returns null', async () => {
    const callback = vi.fn()
    await handlers['storage:get']!('_lease:some-other-key', callback)

    expect(storageMock.getItem).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(null)
  })

  it('storage:set rejects a _lease:-prefixed key via the ack callback', async () => {
    const callback = vi.fn()
    await handlers['storage:set']!({ key: '_lease:some-other-key', value: { lastSeen: 0 } }, callback)

    expect(storageMock.setItem).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })

  it('storage:subscribe ignores a _lease:-prefixed key', async () => {
    await handlers['storage:subscribe']!('_lease:some-other-key')

    expect(fakeSocket.join).not.toHaveBeenCalled()
    expect(storageMock.setItem).not.toHaveBeenCalled()
  })

  it('storage:unsubscribe ignores a _lease:-prefixed key', () => {
    handlers['storage:unsubscribe']!('_lease:some-other-key')

    expect(fakeSocket.leave).not.toHaveBeenCalled()
  })

  it('still allows ordinary keys through', async () => {
    const callback = vi.fn()
    await handlers['storage:set']!({ key: 'room:session-abc', value: { users: [] } }, callback)

    expect(storageMock.setItem).toHaveBeenCalledWith('room:session-abc', { users: [] })
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })
})

describe('devtools instrumentation', () => {
  function mockCommonDependencies(devtoolsEnabled: boolean) {
    vi.doMock('engine.io', () => ({ Server: vi.fn() }))

    vi.doMock('h3', () => ({
      defineEventHandler: vi.fn((handler: unknown) => handler),
      getQuery: vi.fn(() => ({})),
      createError: vi.fn((opts: { statusMessage: string }) => new Error(opts.statusMessage)),
    }))

    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: false,
            logging: { level: null, format: 'text' },
            devtoolsEnabled,
          },
        },
        nuxtRealtime: { eventLogSize: 50 },
      }),
      useStorage: () => ({
        watch: vi.fn().mockResolvedValue(vi.fn()),
        setItem: vi.fn(),
        getItem: vi.fn(),
        getKeys: vi.fn().mockResolvedValue([]),
        removeItem: vi.fn(),
      }),
    }))
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('sets devtoolsState.io to the socket.io server when devtools is enabled', async () => {
    mockCommonDependencies(true)

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    const { default: pluginFactory } = await import('./socketio')
    const { devtoolsState } = await import('../utils/devtools-state')

    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(devtoolsState.io).not.toBeNull()
  })

  it('leaves devtoolsState.io unset when devtools is disabled', async () => {
    mockCommonDependencies(false)

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn()
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    const { default: pluginFactory } = await import('./socketio')
    const { devtoolsState } = await import('../utils/devtools-state')

    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(devtoolsState.io).toBeNull()
  })

  it('records connect, storage:subscribe, storage:set, and disconnect events', async () => {
    mockCommonDependencies(true)

    let connectionHandler: ((socket: unknown) => void) | undefined

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn((event: string, cb: (socket: unknown) => void) => {
        if (event === 'connection') connectionHandler = cb
      })
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      return { Server: IoServer }
    })

    const { default: pluginFactory } = await import('./socketio')
    const { devtoolsState } = await import('../utils/devtools-state')

    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(connectionHandler).toBeTypeOf('function')

    const handlers: Record<string, (...args: unknown[]) => unknown> = {}
    const fakeSocket = {
      id: 'socket-abc',
      rooms: new Set(['socket-abc']),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers[event] = handler
      }),
    }

    connectionHandler!(fakeSocket)

    // 'connect' is recorded synchronously as part of the connection handler.
    expect(devtoolsState.eventLog.list().some(e => e.type === 'connect' && e.socketId === 'socket-abc')).toBe(true)

    handlers['storage:subscribe']!('counter')
    handlers['storage:set']!({ key: 'counter', value: 1 }, undefined)
    await wait(10)
    handlers['disconnect']!('client disconnect')

    const entries = devtoolsState.eventLog.list()
    expect(entries.some(e => e.type === 'storage:subscribe' && e.detail === 'counter')).toBe(true)
    expect(entries.some(e => e.type === 'storage:set' && e.detail === 'counter')).toBe(true)
    expect(entries.some(e => e.type === 'disconnect' && e.detail === 'client disconnect')).toBe(true)
  })
})
