import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => unknown

const EVENTS = [
  'storage:get', 'storage:set', 'storage:subscribe', 'storage:unsubscribe', 'storage:heartbeat',
  'lock:claim', 'lock:release', 'lock:subscribe', 'lock:unsubscribe', 'lock:subscribeRoom',
  'lock:unsubscribeRoom', 'lock:forceRelease', 'presence:join', 'presence:leave',
  'presence:subscribeRoom', 'room:join', 'room:leave', 'event:subscribe', 'event:unsubscribe',
  'event:publish',
]

describe('socketio plugin hardening', () => {
  let client: Storage
  let internal: Storage
  let hooks: Record<string, Handler[]>
  let limits: Record<string, number> | undefined
  let connectionHandler: (socket: unknown) => void
  let engineOptions: { allowRequest: (req: unknown, fn: (err: unknown, ok: boolean) => void) => void }
  let routeHandler: { websocket: { open: (peer: unknown) => void } }
  let rooms: Set<string>
  let toEmit: ReturnType<typeof vi.fn>
  let handlers: Record<string, Handler>
  let socket: Record<string, unknown>
  let serverOptions: Record<string, unknown> | undefined

  async function boot() {
    vi.resetModules()
    const root = createStorage({ driver: memoryDriver() })
    root.mount('nuxt-realtime', memoryDriver())
    root.mount('_nuxt-realtime', memoryDriver())
    client = prefixStorage(root, 'nuxt-realtime')
    internal = prefixStorage(root, '_nuxt-realtime')

    vi.doMock('engine.io', () => ({
      Server: vi.fn(function (opts: typeof engineOptions) {
        engineOptions = opts
      }),
    }))
    vi.doMock('socket.io', () => {
      const IoServer = vi.fn()
      IoServer.prototype.bind = vi.fn()
      IoServer.prototype.on = vi.fn((event: string, cb: (s: unknown) => void) => {
        if (event === 'connection') connectionHandler = cb
      })
      IoServer.prototype.sockets = { adapter: { rooms: { has: vi.fn().mockReturnValue(false) } } }
      IoServer.prototype.to = vi.fn(() => ({ emit: vi.fn() }))
      return { Server: IoServer }
    })
    vi.doMock('h3', () => ({ defineEventHandler: (h: unknown) => h, getQuery: vi.fn(), createError: vi.fn() }))
    vi.doMock('../utils/logger', () => ({
      createRealtimeLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    }))
    vi.doMock('nitropack/runtime', () => ({
      defineNitroPlugin: (factory: unknown) => factory,
      useRuntimeConfig: () => ({
        public: { nuxtRealtime: { cleanup: false, logging: { level: null, format: 'text' }, devtoolsEnabled: false } },
        nuxtRealtime: { lock: { staleGraceMs: 50 }, limits, socketio: { serverOptions } },
      }),
      useStorage: (base?: string) => (base === '_nuxt-realtime' ? internal : client),
    }))

    const { default: pluginFactory } = await import('./socketio')
    await (pluginFactory as unknown as (app: unknown) => Promise<void>)({
      hooks: {
        hook: (name: string, cb: Handler) => {
          (hooks[name] ??= []).push(cb)
        },
        callHook: async (name: string, ...args: unknown[]) => {
          for (const cb of hooks[name] ?? []) await cb(...args)
        },
      },
      router: { use: (_path: string, handler: typeof routeHandler) => (routeHandler = handler) },
    })

    handlers = {}
    rooms = new Set(['socket-a'])
    toEmit = vi.fn()
    socket = {
      id: 'socket-a',
      handshake: { auth: {} },
      rooms,
      emit: vi.fn(),
      join: vi.fn((r: string) => rooms.add(r)),
      leave: vi.fn((r: string) => rooms.delete(r)),
      to: vi.fn(() => ({ emit: toEmit })),
      on: vi.fn((event: string, handler: Handler) => {
        handlers[event] = handler
      }),
    }
    connectionHandler(socket)
  }

  beforeEach(async () => {
    hooks = {}
    limits = undefined
    serverOptions = undefined
    await boot()
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('malformed requests never reject', () => {
    it.each(EVENTS)('%s survives a null/primitive payload and a non-function ack', async (event) => {
      for (const payload of [null, undefined, 42, 'x', true, [], {}]) {
        await expect(Promise.resolve(handlers[event]!(payload, 'not-a-function'))).resolves.not.toThrow()
        await expect(Promise.resolve(handlers[event]!(payload))).resolves.not.toThrow()
      }
    })
  })

  describe('reserved keys are judged after unstorage normalization', () => {
    it.each(['/_lock:victim', '//_lock:victim', ':_conn:victim', '\\_lease:victim', '/_internal:_lock:victim', '?x', '/'])(
      'storage:set rejects %p and writes nothing',
      async (key) => {
        const callback = vi.fn()
        await handlers['storage:set']!({ key, value: 'pwned' }, callback)

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
        expect(await client.getKeys()).toEqual([])
        expect(await internal.getKeys()).toEqual([])
      },
    )

    it.each(['/_lock:victim', ':_conn:victim', '/_internal:_lock:victim'])('storage:get and subscribe reject %p', async (key) => {
      const callback = vi.fn()
      await handlers['storage:get']!(key, callback)
      expect(callback).toHaveBeenCalledWith(null)

      await handlers['storage:subscribe']!(key)
      expect(socket.join).not.toHaveBeenCalled()
    })

    it('stores an ordinary key under its normalized form', async () => {
      const callback = vi.fn()
      await handlers['storage:set']!({ key: '/chat/room', value: 'hi' }, callback)

      expect(callback).toHaveBeenCalledWith({ success: true, status: 'ok' })
      expect(await client.getItem('chat:room')).toBe('hi')
    })
  })

  describe('subscribe/publish authorization hooks', () => {
    it('allows by default', async () => {
      await handlers['event:subscribe']!('admin:feed')
      expect(socket.join).toHaveBeenCalledWith('event:admin:feed')
    })

    it('canSubscribe can deny an event channel, including the wildcard', async () => {
      hooks['nuxt-realtime:canSubscribe'] = [(ctx: { kind: string, name: string, allow: boolean }) => {
        ctx.allow = !(ctx.kind === 'event' && ctx.name.startsWith('admin:')) && ctx.name !== '*'
      }]

      await handlers['event:subscribe']!('admin:feed')
      await handlers['event:subscribe']!('*')
      expect(socket.join).not.toHaveBeenCalled()

      await handlers['event:subscribe']!('public:feed')
      expect(socket.join).toHaveBeenCalledWith('event:public:feed')
    })

    it('canSubscribe gates lock:subscribe and hides the owner', async () => {
      await internal.setItem('_lock:doc', { owner: 'someone' })
      hooks['nuxt-realtime:canSubscribe'] = [(ctx: { allow: boolean }) => {
        ctx.allow = false
      }]

      const callback = vi.fn()
      await handlers['lock:subscribe']!('doc', callback)

      expect(socket.join).not.toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith({ key: 'doc', owner: null, ownerInfo: null })
    })

    it('fails closed when a canSubscribe or canPublish hook throws', async () => {
      hooks['nuxt-realtime:canSubscribe'] = [() => {
        throw new Error('boom')
      }]
      hooks['nuxt-realtime:canPublish'] = [() => {
        throw new Error('boom')
      }]

      await handlers['event:subscribe']!('x')
      expect(socket.join).not.toHaveBeenCalled()

      const callback = vi.fn()
      await handlers['event:publish']!({ channel: 'x', data: 1 }, callback)
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
      expect(socket.to).not.toHaveBeenCalled()
    })

    it('canPublish can deny a publish', async () => {
      hooks['nuxt-realtime:canPublish'] = [(ctx: { channel: string, allow: boolean }) => {
        ctx.allow = ctx.channel !== 'locked'
      }]

      const denied = vi.fn()
      await handlers['event:publish']!({ channel: 'locked', data: 1 }, denied)
      expect(denied).toHaveBeenCalledWith({ success: false, error: 'Not allowed to publish to this channel' })
      expect(socket.to).not.toHaveBeenCalled()

      const allowed = vi.fn()
      await handlers['event:publish']!({ channel: 'open', data: 1 }, allowed)
      expect(allowed).toHaveBeenCalledWith({ success: true })
      expect(toEmit).toHaveBeenCalledWith('event:received', { channel: 'open', data: 1 })
    })

    it.each([42, '', 'x'.repeat(257), null])('rejects an invalid event channel %p', async (channel) => {
      await handlers['event:subscribe']!(channel)
      expect(socket.join).not.toHaveBeenCalled()

      const callback = vi.fn()
      await handlers['event:publish']!({ channel, data: 1 }, callback)
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
    })
  })

  describe('limits', () => {
    const big = 'x'.repeat(300_000)

    it('rejects oversized storage values, lock ownerInfo, presence info and event data', async () => {
      const set = vi.fn()
      await handlers['storage:set']!({ key: 'k', value: big }, set)
      expect(set).toHaveBeenCalledWith({ success: false, error: 'Value too large' })
      expect(await client.getKeys()).toEqual([])

      const claim = vi.fn()
      await handlers['lock:claim']!({ key: 'k', ownerInfo: big }, claim)
      expect(claim).toHaveBeenCalledWith(expect.objectContaining({ success: false }))

      const join = vi.fn()
      await handlers['presence:join']!({ room: 'r', info: big }, join)
      expect(join).toHaveBeenCalledWith(expect.objectContaining({ success: false }))

      const publish = vi.fn()
      await handlers['event:publish']!({ channel: 'c', data: big }, publish)
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
    })

    it('caps distinct keys written and rooms subscribed per socket', async () => {
      limits = { maxKeysPerSocket: 3 }
      await boot()

      const results: unknown[] = []
      for (const key of ['a', 'b', 'c', 'd', 'a']) {
        const cb = vi.fn()
        await handlers['storage:set']!({ key, value: 1 }, cb)
        results.push(cb.mock.calls[0]![0])
      }
      expect(results.map(r => (r as { success: boolean }).success)).toEqual([true, true, true, false, true])

      // `rooms` already holds the socket's own id room
      await handlers['event:subscribe']!('e1')
      await handlers['event:subscribe']!('e2')
      await handlers['event:subscribe']!('e3')
      expect(rooms.has('event:e1')).toBe(true)
      expect(rooms.has('event:e3')).toBe(false)
    })

    it('rate limits a socket and drops the excess events', async () => {
      limits = { maxEventsPerSecond: 3 }
      await boot()

      const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
      for (const [i, cb] of callbacks.entries()) {
        await handlers['storage:set']!({ key: `k${i}`, value: i }, cb)
      }

      expect(callbacks.map(cb => cb.mock.calls.length)).toEqual([1, 1, 1, 0])
      expect(await client.hasItem('k3')).toBe(false)
    })
  })

  describe('connectionId reclaim requires the issued secret', () => {
    function connectWith(id: string, auth: Record<string, unknown>) {
      const s = { ...socket, id, handshake: { auth }, emit: vi.fn(), on: vi.fn(), rooms: new Set([id]) }
      connectionHandler(s)
      return s
    }

    it('issues a secret on first connect and never emits it to anyone else', async () => {
      const s = connectWith('socket-1', { connectionId: 'conn-1' })
      await vi.waitFor(() => expect(s.emit).toHaveBeenCalledWith('connection:identity', { connectionId: 'conn-1', secret: expect.any(String) }))
      expect(s.emit.mock.calls[0]![1].secret.length).toBeGreaterThan(20)
    })
  })

  describe('cross-origin guard', () => {
    const allow = (headers: Record<string, string>) =>
      new Promise<boolean>(resolve => engineOptions.allowRequest({ headers }, (_err, ok) => resolve(ok)))

    it('accepts same-origin and non-browser requests, rejects cross-origin by default', async () => {
      expect(await allow({ host: 'app.test', origin: 'https://app.test' })).toBe(true)
      expect(await allow({ host: 'app.test' })).toBe(true)
      expect(await allow({ host: 'app.test', origin: 'https://evil.test' })).toBe(false)
    })

    it('honors cors.origin when configured', async () => {
      serverOptions = { cors: { origin: ['https://app.test'] } }
      await boot()

      expect(await allow({ host: 'rt.test', origin: 'https://app.test' })).toBe(true)
      expect(await allow({ host: 'rt.test', origin: 'https://evil.test' })).toBe(false)
    })

    it('closes a cross-origin WebSocket upgrade before handing it to Engine.IO', () => {
      const websocket = { close: vi.fn() }
      routeHandler.websocket.open({
        _internal: { nodeReq: { headers: { host: 'app.test', origin: 'https://evil.test' }, socket: {} } },
        websocket,
      })

      expect(websocket.close).toHaveBeenCalledWith(1008, 'Origin not allowed')
    })
  })
})
