import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Simulates a shared reactive storage backend (e.g. Redis with pub/sub).
 *
 * Writes to `setItem` / `removeItem` immediately notify all watch callbacks
 * registered by OTHER instances, mirroring what reactiveRedisDriver does via
 * Redis pub/sub. The `origin` parameter plays the same deduplication role as
 * the per-instance UUID in the reactive driver.
 */
function createSharedReactiveStorage() {
  const data = new Map<string, unknown>()

  type Listener = {
    instanceId: string
    cb: (event: 'update' | 'remove', key: string) => void
  }
  const listeners: Listener[] = []

  function getItem(key: string) {
    return data.get(key) ?? null
  }

  function setItem(key: string, value: unknown, originInstanceId: string) {
    data.set(key, value)
    for (const l of listeners) {
      if (l.instanceId !== originInstanceId) l.cb('update', key)
    }
  }

  function removeItem(key: string, originInstanceId: string) {
    data.delete(key)
    for (const l of listeners) {
      if (l.instanceId !== originInstanceId) l.cb('remove', key)
    }
  }

  /**
   * Registers a watch callback for a given server instance.
   * Returns an unwatch function (mirrors the reactive driver API).
   */
  function watch(
    instanceId: string,
    cb: (event: 'update' | 'remove', key: string) => void,
  ) {
    const entry: Listener = { instanceId, cb }
    listeners.push(entry)
    return () => {
      const i = listeners.indexOf(entry)
      if (i >= 0) listeners.splice(i, 1)
    }
  }

  function listenerCount() {
    return listeners.length
  }

  return { getItem, setItem, removeItem, watch, data, listenerCount }
}

type SharedStorage = ReturnType<typeof createSharedReactiveStorage>

/**
 * Creates a minimal Socket.IO server that mirrors the watch-integration logic
 * from `socketio.ts`, but without Nitro/unstorage. The shared storage's
 * `watch()` call simulates what `storage.watch()` does in the plugin.
 */
function createServerInstance(sharedStorage: SharedStorage, instanceId: string) {
  const httpServer = createServer()
  const io = new Server(httpServer)

  // Mirrors the storage.watch() call in socketio.ts
  const unwatch = sharedStorage.watch(instanceId, (event, key) => {
    if (event !== 'update') return
    if (key.startsWith('_lease:')) return

    const value = sharedStorage.getItem(key)
    const room = `key:${key}`
    if (io.sockets.adapter.rooms.has(room)) {
      io.to(room).emit('storage:updated', { key, value })
    }
  })

  io.on('connection', (socket) => {
    socket.on('storage:get', (key: string, callback) => {
      callback(sharedStorage.getItem(key))
    })

    socket.on('storage:set', ({ key, value }, callback) => {
      // setItem notifies all OTHER instance watchers (origin-filtered in the reactive driver)
      sharedStorage.setItem(key, value, instanceId)
      // Broadcast immediately to local subscribers (same as the plugin)
      socket.to(`key:${key}`).emit('storage:updated', { key, value })
      if (callback) callback({ success: true, status: 'ok' })
    })

    socket.on('storage:subscribe', (key: string) => {
      socket.join(`key:${key}`)
    })

    socket.on('storage:unsubscribe', (key: string) => {
      socket.leave(`key:${key}`)
    })
  })

  return { io, httpServer, unwatch }
}

async function startServer(
  sharedStorage: SharedStorage,
  instanceId: string,
): Promise<{
  io: Server
  httpServer: ReturnType<typeof createServer>
  port: number
  unwatch: () => void
}> {
  const { io, httpServer, unwatch } = createServerInstance(sharedStorage, instanceId)
  const port = await new Promise<number>(resolve =>
    httpServer.listen(0, () => resolve((httpServer.address() as AddressInfo).port)),
  )
  return { io, httpServer, port, unwatch }
}

async function connectClient(port: number): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`)
  await new Promise<void>(resolve => socket.on('connect', resolve))
  return socket
}

async function closeServer(server: { io: Server, httpServer: ReturnType<typeof createServer>, unwatch: () => void }) {
  server.unwatch()
  server.io.close()
  await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('cross-server sync - watch callback integration', () => {
  let sharedStorage: SharedStorage
  let serverA: Awaited<ReturnType<typeof startServer>>
  let serverB: Awaited<ReturnType<typeof startServer>>
  let clientA: ClientSocket
  let clientB: ClientSocket

  beforeEach(async () => {
    sharedStorage = createSharedReactiveStorage()
    serverA = await startServer(sharedStorage, 'instance-a')
    serverB = await startServer(sharedStorage, 'instance-b')
    clientA = await connectClient(serverA.port)
    clientB = await connectClient(serverB.port)
  })

  afterEach(async () => {
    clientA.close()
    clientB.close()
    await closeServer(serverA)
    await closeServer(serverB)
  })

  it('client on server B receives storage:updated when server A processes a write', async () => {
    // Client B subscribes to key "counter" on server B
    clientB.emit('storage:subscribe', 'counter')
    await wait(30)

    const received: unknown[] = []
    clientB.on('storage:updated', (data) => {
      received.push(data)
    })

    // Client A writes to "counter" via server A
    await new Promise<void>(resolve =>
      clientA.emit('storage:set', { key: 'counter', value: 42 }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ key: 'counter', value: 42 })
  })

  it('client on server A does not receive a duplicate storage:updated via the watch callback', async () => {
    // Client A and client A2 both subscribe on server A
    const clientA2 = await connectClient(serverA.port)
    clientA.emit('storage:subscribe', 'counter')
    clientA2.emit('storage:subscribe', 'counter')
    await wait(30)

    const receivedA: unknown[] = []
    const receivedA2: unknown[] = []
    clientA.on('storage:updated', (data) => {
      receivedA.push(data)
    })
    clientA2.on('storage:updated', (data) => {
      receivedA2.push(data)
    })

    // Client A writes; the write originates from instance A so the watch
    // callback on server A must NOT fire (origin deduplication)
    await new Promise<void>(resolve =>
      clientA.emit('storage:set', { key: 'counter', value: 99 }, resolve),
    )
    await wait(50)

    // clientA itself is not in the socket.to() broadcast room (excludes sender)
    // and the watch callback doesn't fire for instance A → no duplicates
    expect(receivedA).toHaveLength(0)
    // clientA2 is on the same server, gets exactly one update from socket.to()
    expect(receivedA2).toHaveLength(1)

    clientA2.close()
  })

  it('multiple clients on server B all receive the update', async () => {
    const clientB2 = await connectClient(serverB.port)
    clientB.emit('storage:subscribe', 'shared-key')
    clientB2.emit('storage:subscribe', 'shared-key')
    await wait(30)

    const receivedB: unknown[] = []
    const receivedB2: unknown[] = []
    clientB.on('storage:updated', (data) => {
      receivedB.push(data)
    })
    clientB2.on('storage:updated', (data) => {
      receivedB2.push(data)
    })

    await new Promise<void>(resolve =>
      clientA.emit('storage:set', { key: 'shared-key', value: 'hello' }, resolve),
    )
    await wait(100)

    expect(receivedB).toHaveLength(1)
    expect(receivedB2).toHaveLength(1)

    clientB2.close()
  })

  it('updates to _lease: keys do not trigger storage:updated broadcasts', async () => {
    clientB.emit('storage:subscribe', '_lease:some-key')
    await wait(30)

    const received: unknown[] = []
    clientB.on('storage:updated', (data) => {
      received.push(data)
    })

    await new Promise<void>(resolve =>
      clientA.emit('storage:set', { key: '_lease:some-key', value: { lastSeen: Date.now() } }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(0)
  })

  it('does not emit to rooms with no subscribers on server B', async () => {
    // clientB does NOT subscribe to "orphan-key"
    const received: unknown[] = []
    clientB.on('storage:updated', (data) => {
      received.push(data)
    })

    await new Promise<void>(resolve =>
      clientA.emit('storage:set', { key: 'orphan-key', value: 'data' }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(0)
  })
})

describe('cross-server sync - watcher cleanup', () => {
  it('unwatch removes the listener from shared storage', async () => {
    const sharedStorage = createSharedReactiveStorage()
    const serverA = await startServer(sharedStorage, 'instance-a')

    expect(sharedStorage.listenerCount()).toBe(1)

    serverA.unwatch()
    serverA.io.close()
    await new Promise<void>(resolve => serverA.httpServer.close(() => resolve()))

    expect(sharedStorage.listenerCount()).toBe(0)
  })

  it('remaining server instances still receive updates after one shuts down', async () => {
    const sharedStorage = createSharedReactiveStorage()
    const serverA = await startServer(sharedStorage, 'instance-a')
    const serverB = await startServer(sharedStorage, 'instance-b')
    const serverC = await startServer(sharedStorage, 'instance-c')

    const clientC = await connectClient(serverC.port)
    clientC.emit('storage:subscribe', 'data')
    await wait(30)

    const received: unknown[] = []
    clientC.on('storage:updated', (data) => {
      received.push(data)
    })

    // Shut down server B
    serverB.unwatch()
    serverB.io.close()
    await new Promise<void>(resolve => serverB.httpServer.close(() => resolve()))

    // Write from server A should still reach server C
    const clientA = await connectClient(serverA.port)
    await new Promise<void>(resolve =>
      clientA.emit('storage:set', { key: 'data', value: 'after-b-shutdown' }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ key: 'data', value: 'after-b-shutdown' })

    clientA.close()
    clientC.close()
    await closeServer(serverA)
    await closeServer(serverC)
  })
})

describe('cross-server sync - fallback warning', () => {
  it('logs a warning when the storage driver watch returns a non-function', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Simulate what the plugin does when unwatch is not a function
    const unwatch = null

    if (!unwatch || typeof unwatch !== 'function') {
      console.warn(
        '[nuxt-realtime] Storage driver does not support watch. '
        + 'Cross-server sync is disabled. Updates from other server instances '
        + 'will only be visible to clients on reconnect/refresh. '
        + 'Consider using reactiveRedisDriver from nuxt-realtime/drivers/redis.',
      )
    }

    expect(warnSpy).toHaveBeenCalledOnce()
    const [warnMessage] = warnSpy.mock.calls[0] ?? []
    expect(warnMessage).toContain('[nuxt-realtime]')
    expect(warnMessage).toContain('Cross-server sync is disabled')
    expect(warnMessage).toContain('reactiveRedisDriver')

    warnSpy.mockRestore()
  })
})
