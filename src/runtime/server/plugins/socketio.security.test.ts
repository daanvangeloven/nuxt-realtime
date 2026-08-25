import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { isRoomMember } from '../utils/room-registry'
import { getLocksOwnedBy, getRoomKeys } from '../utils/lock'

// Every internal key prefix, kept explicit so a new prefix that forgets the `_` convention
// fails loudly here instead of silently going untested.
const RESERVED_PREFIXES = [
  '_lock:',
  '_lockinfo:',
  '_lockowner:',
  '_ownerlocks:',
  '_lockroom:',
  '_roomkeys:',
  '_presence:',
  '_connrooms:',
  '_roommember:',
  '_memberrooms:',
  '_roomcreated:',
  '_roomclosing:',
  '_conn:',
  '_reclaiming:',
  '_lease:',
]

const RESERVED_KEYS: unknown[] = RESERVED_PREFIXES.map(prefix => `${prefix}some-target`)

// Non-string/empty keys must be rejected like a reserved prefix, not throw.
const INVALID_KEYS: unknown[] = ['', null, undefined, 42, {}]

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Mounts both storage namespaces so useStorage() can be routed by mount name, like the plugin.
function createRealtimeTestStorages(): { client: Storage, internal: Storage } {
  const root = createStorage({ driver: memoryDriver() })
  root.mount('nuxt-realtime', memoryDriver())
  root.mount('_nuxt-realtime', memoryDriver())
  return {
    client: prefixStorage(root, 'nuxt-realtime'),
    internal: prefixStorage(root, '_nuxt-realtime'),
  }
}

describe('storage:get/set/subscribe reject every internal prefix and invalid key shape', () => {
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

  it.each([...RESERVED_KEYS, ...INVALID_KEYS])('storage:get rejects %p without touching storage', async (key) => {
    const callback = vi.fn()
    await handlers['storage:get']!(key, callback)

    expect(storageMock.getItem).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(null)
  })

  it.each([...RESERVED_KEYS, ...INVALID_KEYS])('storage:set rejects %p via the ack callback without touching storage', async (key) => {
    const callback = vi.fn()
    await handlers['storage:set']!({ key, value: 'anything' }, callback)

    expect(storageMock.setItem).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })

  it.each([...RESERVED_KEYS, ...INVALID_KEYS])('storage:subscribe rejects %p without joining a key room', async (key) => {
    await handlers['storage:subscribe']!(key)

    expect(fakeSocket.join).not.toHaveBeenCalled()
    expect(storageMock.setItem).not.toHaveBeenCalled()
  })

  it.each([...RESERVED_KEYS, ...INVALID_KEYS])('storage:unsubscribe ignores %p without leaving a key room', (key) => {
    handlers['storage:unsubscribe']!(key)

    expect(fakeSocket.leave).not.toHaveBeenCalled()
  })
})

describe('storage:get/set/subscribe still work for ordinary, non-underscore-prefixed keys', () => {
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

  // 'user_prefs': underscore mid-string is fine, only a leading '_' is reserved.
  const VALID_KEYS = ['counter', 'user_prefs', 'chat:room:1', 'room:abc:doc']

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

  it.each(VALID_KEYS)('storage:get passes %p through to storage.getItem', async (key) => {
    storageMock.getItem.mockResolvedValueOnce(`value-for-${key}`)
    const callback = vi.fn()
    await handlers['storage:get']!(key, callback)

    expect(storageMock.getItem).toHaveBeenCalledWith(key)
    expect(callback).toHaveBeenCalledWith(`value-for-${key}`)
  })

  it.each(VALID_KEYS)('storage:set passes %p through to storage.setItem', async (key) => {
    const callback = vi.fn()
    await handlers['storage:set']!({ key, value: { n: 1 } }, callback)

    expect(storageMock.setItem).toHaveBeenCalledWith(key, { n: 1 })
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it.each(VALID_KEYS)('storage:subscribe joins the key: room for %p', async (key) => {
    await handlers['storage:subscribe']!(key)

    expect(fakeSocket.join).toHaveBeenCalledWith(`key:${key}`)
  })
})

describe('mount isolation: a client cannot forge module state through storage:set', () => {
  let client: Storage
  let internal: Storage
  let connectionHandler: ((socket: unknown) => void | Promise<void>) | undefined

  function makeFakeSocket(id: string, connectionId?: string) {
    const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {}
    const rooms = new Set([id])
    return {
      id,
      handshake: { auth: connectionId ? { connectionId } : {} },
      rooms,
      handlers,
      join: vi.fn((room: string) => rooms.add(room)),
      leave: vi.fn((room: string) => rooms.delete(room)),
      to: vi.fn(() => ({ emit: vi.fn() })),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        (handlers[event] ??= []).push(handler)
      }),
    }
  }

  async function connect(id: string, connectionId?: string) {
    const socket = makeFakeSocket(id, connectionId)
    await connectionHandler!(socket)
    return { socket }
  }

  beforeEach(async () => {
    vi.resetModules()
    ;({ client, internal } = createRealtimeTestStorages())

    vi.doMock('engine.io', () => ({ Server: vi.fn() }))

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn((event: string, cb: (socket: unknown) => void) => {
        if (event === 'connection') connectionHandler = cb
      })
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      IoServer.prototype.to = vi.fn(() => ({ emit: vi.fn() }))
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
      useStorage: (name?: string) => (name === '_nuxt-realtime' ? internal : client),
    }))

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: { hook: vi.fn(), callHook: vi.fn().mockResolvedValue(undefined) },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('storage:set of _roommember:{room}:{connectionId} is rejected and never grants room membership', async () => {
    const { socket } = await connect('socket-a', 'victim-conn')
    const callback = vi.fn()
    await socket.handlers['storage:set']![0]!({ key: '_roommember:private-room:victim-conn', value: true }, callback)

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
    await expect(isRoomMember(internal, 'private-room', 'victim-conn')).resolves.toBe(false)
    // Rejected before storage.setItem runs, not just invisible to isRoomMember.
    await expect(client.getItem('_roommember:private-room:victim-conn')).resolves.toBeNull()
  })

  it('the client and internal mounts are separate stores: seeding the client mount directly still leaves room membership false', async () => {
    // Bypasses storage:set entirely which proves the mount split is the boundary, not just the guard.
    await client.setItem('_roommember:private-room:someone-else', true)

    await expect(isRoomMember(internal, 'private-room', 'someone-else')).resolves.toBe(false)
  })
})

describe('cleanup job releases idle locks through releaseLock(), not just the lease', () => {
  let client: Storage
  let internal: Storage
  let connectionHandler: ((socket: unknown) => void | Promise<void>) | undefined
  let ioEmits: Array<{ rooms: string[], event: string, data: unknown }>
  let hookHandlers: Record<string, Array<(...args: unknown[]) => unknown>>

  function callHook(name: string, ...args: unknown[]) {
    return Promise.all((hookHandlers[name] ?? []).map(h => h(...args)))
  }

  function makeFakeSocket(id: string, connectionId?: string) {
    const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {}
    const rooms = new Set([id])
    return {
      id,
      handshake: { auth: connectionId ? { connectionId } : {} },
      rooms,
      handlers,
      join: vi.fn((room: string) => rooms.add(room)),
      leave: vi.fn((room: string) => rooms.delete(room)),
      to: vi.fn(() => ({ emit: vi.fn() })),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        (handlers[event] ??= []).push(handler)
      }),
    }
  }

  async function connect(id: string, connectionId?: string) {
    const socket = makeFakeSocket(id, connectionId)
    await connectionHandler!(socket)
    return { socket }
  }

  beforeEach(async () => {
    vi.resetModules()
    ;({ client, internal } = createRealtimeTestStorages())
    hookHandlers = {}
    ioEmits = []

    vi.doMock('engine.io', () => ({ Server: vi.fn() }))

    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn((event: string, cb: (socket: unknown) => void) => {
        if (event === 'connection') connectionHandler = cb
      })
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      IoServer.prototype.to = vi.fn((r: string | string[]) => ({
        emit: vi.fn((event: string, data: unknown) => {
          ioEmits.push({ rooms: Array.isArray(r) ? r : [r], event, data })
        }),
      }))
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
            // Short interval/threshold to avoid waiting out real-world cleanup defaults.
            cleanup: { heartbeatInterval: 10_000, cleanupInterval: 50, idleThreshold: 10 },
            logging: { level: null, format: 'text' },
          },
        },
        nuxtRealtime: {},
      }),
      useStorage: (name?: string) => (name === '_nuxt-realtime' ? internal : client),
    }))

    const { default: pluginFactory } = await import('./socketio')
    const nitroApp = {
      hooks: {
        hook: (name: string, cb: (...args: unknown[]) => unknown) => {
          (hookHandlers[name] ??= []).push(cb)
        },
        callHook,
      },
      router: { use: vi.fn() },
    }
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)(nitroApp)
  })

  afterEach(async () => {
    // Stop the cleanup interval so it doesn't keep firing after the test tears down.
    await Promise.all((hookHandlers['close'] ?? []).map(h => h()))
    vi.resetModules()
  })

  it('reaps an idle lock: clears the owner/room reverse indexes and broadcasts lock:changed', async () => {
    const { socket } = await connect('socket-a', 'conn-1')
    await socket.handlers['lock:claim']![0]!({ key: 'doc-1', room: 'project-1' }, vi.fn())

    // Sanity check the claim landed before waiting for cleanup to reap it.
    await expect(getLocksOwnedBy(internal, 'conn-1')).resolves.toEqual(['doc-1'])
    await expect(getRoomKeys(internal, 'project-1')).resolves.toEqual(['doc-1'])

    await wait(300) // several cleanupInterval (50ms) ticks past idleThreshold (10ms)

    await expect(getLocksOwnedBy(internal, 'conn-1')).resolves.toEqual([])
    await expect(getRoomKeys(internal, 'project-1')).resolves.toEqual([])
    expect(ioEmits).toContainEqual({
      rooms: ['lock:doc-1', 'lockroom:project-1'],
      event: 'lock:changed',
      data: { key: 'doc-1', owner: null, room: 'project-1' },
    })
  }, 10_000)
})
