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

describe('nuxt-realtime:io hook — middleware runs before connection', () => {
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

    socket.on('storage:unsubscribe', (key: string, callback?: () => void) => {
      socket.leave(`key:${key}`)
      callback?.()
    })

    socket.on('storage:heartbeat', (callback?: () => void) => {
      const storageRooms = [...socket.rooms].filter(r => r.startsWith('key:'))
      storageRooms.forEach(room => touchLease(room.slice(4)))
      callback?.()
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
    await new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-abc', resolve))

    expect(storage.has('_lease:room:session-abc')).toBe(true)
    const lease = storage.get('_lease:room:session-abc') as { lastSeen: number }
    expect(lease.lastSeen).toBeCloseTo(Date.now(), -3)
  })

  it('creates a lease when setting a key', async () => {
    await new Promise<void>(resolve => client.emit('storage:set', { key: 'room:session-def', value: { users: [] } }, resolve))

    expect(storage.has('_lease:room:session-def')).toBe(true)
  })

  it('updates lastSeen on storage:set', async () => {
    await new Promise<void>(resolve => client.emit('storage:subscribe', 'room:session-abc', resolve))

    const firstSeen = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen

    await wait(20)
    await new Promise<void>(resolve => client.emit('storage:set', { key: 'room:session-abc', value: { users: [] } }, resolve))

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

    await new Promise<void>(resolve => client.emit('storage:unsubscribe', 'room:session-abc', resolve))

    const leaseBefore = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen

    await new Promise<void>(resolve => client.emit('storage:heartbeat', resolve))

    const leaseAfter = (storage.get('_lease:room:session-abc') as { lastSeen: number }).lastSeen
    expect(leaseAfter).toBe(leaseBefore)
  })
})

describe('cleanup - job (via plugin)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>
  let capturedCleanupFn: (() => Promise<void>) | null

  function createMapStorage() {
    const data = new Map<string, unknown>()
    return {
      data,
      watch: vi.fn().mockResolvedValue(vi.fn()),
      setItem: vi.fn().mockImplementation(async (key: string, value: unknown) => { data.set(key, value) }),
      getItem: vi.fn().mockImplementation(async (key: string) => data.get(key) ?? null),
      getKeys: vi.fn().mockImplementation(async () => [...data.keys()]),
      removeItem: vi.fn().mockImplementation(async (key: string) => { data.delete(key) }),
    }
  }

  beforeEach(() => {
    capturedCleanupFn = null
    vi.resetModules()

    setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
      capturedCleanupFn = callback as () => Promise<void>
      return 999 as unknown as ReturnType<typeof setInterval>
    })

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
  })

  afterEach(() => {
    setIntervalSpy.mockRestore()
    vi.resetModules()
  })

  async function initPlugin(storage: ReturnType<typeof createMapStorage>) {
    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: {
          nuxtRealtime: {
            cleanup: { heartbeatInterval: 30_000, cleanupInterval: 60_000, idleThreshold: 50 },
            logging: { level: null, format: 'text' },
          },
        },
        nuxtRealtime: {},
      }),
      useStorage: () => storage,
    }))

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)
  }

  it('removes stale data key and lease key after idle threshold', async () => {
    const storage = createMapStorage()
    await initPlugin(storage)

    storage.data.set('room:session-abc', { users: [] })
    storage.data.set('_lease:room:session-abc', { lastSeen: Date.now() - 200 })

    await capturedCleanupFn!()

    expect(storage.data.has('room:session-abc')).toBe(false)
    expect(storage.data.has('_lease:room:session-abc')).toBe(false)
  })

  it('does not remove keys within the idle threshold', async () => {
    const storage = createMapStorage()
    await initPlugin(storage)

    storage.data.set('room:session-abc', { users: [] })
    storage.data.set('_lease:room:session-abc', { lastSeen: Date.now() })

    await capturedCleanupFn!()

    expect(storage.data.has('room:session-abc')).toBe(true)
    expect(storage.data.has('_lease:room:session-abc')).toBe(true)
  })

  it('cleans up multiple stale keys in one pass', async () => {
    const storage = createMapStorage()
    await initPlugin(storage)

    const staleTime = Date.now() - 200
    for (const n of [1, 2, 3]) {
      storage.data.set(`room:session-${n}`, { users: [] })
      storage.data.set(`_lease:room:session-${n}`, { lastSeen: staleTime })
    }

    await capturedCleanupFn!()

    for (const n of [1, 2, 3]) {
      expect(storage.data.has(`room:session-${n}`)).toBe(false)
      expect(storage.data.has(`_lease:room:session-${n}`)).toBe(false)
    }
  })

  it('only cleans up keys with a lease, leaves unmanaged keys alone', async () => {
    const storage = createMapStorage()
    await initPlugin(storage)

    storage.data.set('config:feature-flags', { enabled: true })

    await capturedCleanupFn!()

    expect(storage.data.has('config:feature-flags')).toBe(true)
  })
})

describe('fallback warnings', () => {
  let warnMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    warnMock = vi.fn()

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
        warn: warnMock,
      }),
    }))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('warns when storage.watch() returns a non-function', async () => {
    vi.doMock('nuxt-realtime/drivers/redis', () => ({
      reactiveRedisDriver: vi.fn().mockReturnValue({}),
      // Must use a regular function — arrow functions cannot be used with `new`
      RealtimePubSub: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.instanceId = 'test'
        this.publish = vi.fn()
        this.subscribe = vi.fn().mockReturnValue(vi.fn())
        this.dispose = vi.fn().mockResolvedValue(undefined)
      }),
    }))

    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: { nuxtRealtime: { cleanup: false, logging: { level: null, format: 'text' } } },
        nuxtRealtime: { redis: {} },
      }),
      // Called twice: once without prefix for rootStorage (mount/unmount), once with 'nuxt-realtime'
      useStorage: vi.fn()
        .mockReturnValueOnce({
          mount: vi.fn(),
          unmount: vi.fn().mockResolvedValue(undefined),
        })
        .mockReturnValue({
          watch: vi.fn().mockResolvedValue(null),
          setItem: vi.fn(),
          getItem: vi.fn(),
          getKeys: vi.fn().mockResolvedValue([]),
          removeItem: vi.fn(),
        }),
    }))

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('Storage driver does not support watch'))
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('reactiveRedisDriver'))
    expect(warnMock).not.toHaveBeenCalledWith(expect.stringContaining('No Redis pub/sub configured'))
  })

  it('warns when no Redis pub/sub is configured', async () => {
    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: (app: unknown) => unknown) => factory,
      useRuntimeConfig: () => ({
        public: { nuxtRealtime: { cleanup: false, logging: { level: null, format: 'text' } } },
        nuxtRealtime: {}, // no redis key → pubsub stays null
      }),
      useStorage: () => ({
        watch: vi.fn().mockResolvedValue(vi.fn()), // valid unwatch → no storage warning
        setItem: vi.fn(),
        getItem: vi.fn(),
        getKeys: vi.fn().mockResolvedValue([]),
        removeItem: vi.fn(),
      }),
    }))

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)

    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('No Redis pub/sub configured'))
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('nuxtRealtime.redis'))
    expect(warnMock).not.toHaveBeenCalledWith(expect.stringContaining('Storage driver does not support watch'))
  })
})
