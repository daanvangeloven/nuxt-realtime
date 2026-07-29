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

    socket.on('storage:unsubscribe', (key: string) => {
      socket.leave(`key:${key}`)
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
