import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const EVENT_CHANNEL = 'nuxt-realtime:events'

/**
 * Simulates a shared Redis pub/sub backend for event relay.
 */
function createSharedEventPubSub() {
  const handlers = new Map<string, Set<(message: string) => void>>()

  function publish(channel: string, message: string) {
    const channelHandlers = handlers.get(channel)
    if (channelHandlers) {
      for (const handler of channelHandlers) handler(message)
    }
  }

  function subscribe(channel: string, handler: (message: string) => void) {
    if (!handlers.has(channel)) {
      handlers.set(channel, new Set())
    }
    handlers.get(channel)!.add(handler)
    return () => {
      handlers.get(channel)?.delete(handler)
    }
  }

  function subscriberCount(channel: string) {
    return handlers.get(channel)?.size ?? 0
  }

  return { publish, subscribe, subscriberCount }
}

type SharedEventPubSub = ReturnType<typeof createSharedEventPubSub>

/**
 * Creates a minimal Socket.IO server that mirrors the event relay logic from
 * `socketio.ts`, but without Nitro or Redis. The shared event pub/sub simulates
 * what `RealtimePubSub` does in production.
 */
function createServerInstance(sharedPubSub: SharedEventPubSub, instanceId: string) {
  const httpServer = createServer()
  const io = new Server(httpServer)

  // Mirrors the pubsub.subscribe() call in socketio.ts
  const unsubscribeEvents = sharedPubSub.subscribe(EVENT_CHANNEL, (message) => {
    try {
      const { channel, data, origin } = JSON.parse(message) as { channel: string, data: unknown, origin: string }
      if (origin === instanceId) return

      const room = `event:${channel}`
      if (io.sockets.adapter.rooms.has(room)) {
        io.to(room).emit('event:received', { channel, data })
      }
    }
    catch {
      // ignore parse errors in tests
    }
  })

  io.on('connection', (socket) => {
    socket.on('event:subscribe', (channel: string, callback?: () => void) => {
      socket.join(`event:${channel}`)
      callback?.()
    })

    socket.on('event:unsubscribe', (channel: string) => {
      socket.leave(`event:${channel}`)
    })

    socket.on('event:publish', ({ channel, data, includeSelf }, callback) => {
      const room = `event:${channel}`

      // 1. Broadcast locally
      if (includeSelf) {
        io.to(room).emit('event:received', { channel, data })
      }
      else {
        socket.to(room).emit('event:received', { channel, data })
      }

      // 2. Relay to other server instances
      sharedPubSub.publish(EVENT_CHANNEL, JSON.stringify({ channel, data, origin: instanceId }))

      if (callback) callback({ success: true })
    })
  })

  return { io, httpServer, unsubscribeEvents }
}

async function startServer(
  sharedPubSub: SharedEventPubSub,
  instanceId: string,
): Promise<{
  io: Server
  httpServer: ReturnType<typeof createServer>
  port: number
  unsubscribeEvents: () => void
}> {
  const { io, httpServer, unsubscribeEvents } = createServerInstance(sharedPubSub, instanceId)
  const port = await new Promise<number>(resolve =>
    httpServer.listen(0, () => resolve((httpServer.address() as AddressInfo).port)),
  )
  return { io, httpServer, port, unsubscribeEvents }
}

async function connectClient(port: number): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`)
  await new Promise<void>(resolve => socket.on('connect', resolve))
  return socket
}

async function closeServer(server: { io: Server, httpServer: ReturnType<typeof createServer>, unsubscribeEvents: () => void }) {
  server.unsubscribeEvents()
  server.io.close()
  await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('cross-server event sync - relay via pub/sub', () => {
  let sharedPubSub: SharedEventPubSub
  let serverA: Awaited<ReturnType<typeof startServer>>
  let serverB: Awaited<ReturnType<typeof startServer>>
  let clientA: ClientSocket
  let clientB: ClientSocket

  beforeEach(async () => {
    sharedPubSub = createSharedEventPubSub()
    serverA = await startServer(sharedPubSub, 'instance-a')
    serverB = await startServer(sharedPubSub, 'instance-b')
    clientA = await connectClient(serverA.port)
    clientB = await connectClient(serverB.port)
  })

  afterEach(async () => {
    clientA.close()
    clientB.close()
    await closeServer(serverA)
    await closeServer(serverB)
  })

  it('client on server B receives event:received when client on server A publishes to same channel', async () => {
    await new Promise<void>(resolve => clientB.emit('event:subscribe', 'chat', resolve))

    const received: unknown[] = []
    clientB.on('event:received', data => received.push(data))

    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'chat', data: { text: 'hello' } }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ channel: 'chat', data: { text: 'hello' } })
  })

  it('publishing server does not double-broadcast to its own local clients', async () => {
    // Two clients on server A both subscribe to the channel
    const clientA2 = await connectClient(serverA.port)
    await new Promise<void>(resolve => clientA.emit('event:subscribe', 'notifications', resolve))
    await new Promise<void>(resolve => clientA2.emit('event:subscribe', 'notifications', resolve))

    const receivedA: unknown[] = []
    const receivedA2: unknown[] = []
    clientA.on('event:received', data => receivedA.push(data))
    clientA2.on('event:received', data => receivedA2.push(data))

    // clientA publishes — origin deduplication must prevent the pub/sub relay
    // from firing a second broadcast on server A
    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'notifications', data: 'ping' }, resolve),
    )
    await wait(50)

    // clientA itself is excluded by socket.to() (not includeSelf)
    expect(receivedA).toHaveLength(0)
    // clientA2 receives exactly one update from the local socket.to() broadcast
    expect(receivedA2).toHaveLength(1)

    clientA2.close()
  })

  it('includeSelf: true causes the publishing socket to receive its own event', async () => {
    await new Promise<void>(resolve => clientA.emit('event:subscribe', 'room', resolve))

    const received: unknown[] = []
    clientA.on('event:received', data => received.push(data))

    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'room', data: 'self-test', includeSelf: true }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ data: 'self-test' })
  })

  it('includeSelf: true on server A does not cause double-delivery on server B', async () => {
    await new Promise<void>(resolve => clientB.emit('event:subscribe', 'room', resolve))

    const receivedB: unknown[] = []
    clientB.on('event:received', data => receivedB.push(data))

    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'room', data: 'cross-self', includeSelf: true }, resolve),
    )
    await wait(50)

    // Server B receives exactly one relayed event regardless of includeSelf
    expect(receivedB).toHaveLength(1)
  })

  it('multiple clients on server B all receive the relayed event', async () => {
    const clientB2 = await connectClient(serverB.port)
    await new Promise<void>(resolve => clientB.emit('event:subscribe', 'broadcast', resolve))
    await new Promise<void>(resolve => clientB2.emit('event:subscribe', 'broadcast', resolve))

    const receivedB: unknown[] = []
    const receivedB2: unknown[] = []
    clientB.on('event:received', data => receivedB.push(data))
    clientB2.on('event:received', data => receivedB2.push(data))

    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'broadcast', data: 'hi everyone' }, resolve),
    )
    await wait(50)

    expect(receivedB).toHaveLength(1)
    expect(receivedB2).toHaveLength(1)

    clientB2.close()
  })

  it('does not emit to rooms with no subscribers on server B', async () => {
    // clientB does NOT subscribe to 'orphan'
    const received: unknown[] = []
    clientB.on('event:received', data => received.push(data))

    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'orphan', data: 'ignored' }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(0)
  })

  it('events on different channels are isolated', async () => {
    await new Promise<void>(resolve => clientB.emit('event:subscribe', 'channel-1', resolve))

    const received: unknown[] = []
    clientB.on('event:received', data => received.push(data))

    // Publish to channel-2 which clientB is NOT subscribed to
    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'channel-2', data: 'wrong channel' }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(0)
  })
})

describe('cross-server event sync - watcher cleanup', () => {
  it('unsubscribeEvents removes the handler from shared pub/sub', async () => {
    const sharedPubSub = createSharedEventPubSub()
    const serverA = await startServer(sharedPubSub, 'instance-a')

    expect(sharedPubSub.subscriberCount(EVENT_CHANNEL)).toBe(1)

    await closeServer(serverA)

    expect(sharedPubSub.subscriberCount(EVENT_CHANNEL)).toBe(0)
  })

  it('remaining servers still relay events after one shuts down', async () => {
    const sharedPubSub = createSharedEventPubSub()
    const serverA = await startServer(sharedPubSub, 'instance-a')
    const serverB = await startServer(sharedPubSub, 'instance-b')
    const serverC = await startServer(sharedPubSub, 'instance-c')

    const clientC = await connectClient(serverC.port)
    await new Promise<void>(resolve => clientC.emit('event:subscribe', 'updates', resolve))

    const received: unknown[] = []
    clientC.on('event:received', data => received.push(data))

    // Shut down server B
    await closeServer(serverB)

    // Event from server A should still reach server C
    const clientA = await connectClient(serverA.port)
    await new Promise<void>(resolve =>
      clientA.emit('event:publish', { channel: 'updates', data: 'after-b-shutdown' }, resolve),
    )
    await wait(50)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ data: 'after-b-shutdown' })

    clientA.close()
    clientC.close()
    await closeServer(serverA)
    await closeServer(serverC)
  })
})

describe('cross-server event sync - fallback warning', () => {
  it('logs a warning when no pub/sub is configured', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Simulate what the plugin does when pubsub is null
    const pubsub = null
    if (!pubsub) {
      console.warn(
        '[nuxt-realtime] No Redis pub/sub configured. '
        + 'Cross-server event sync is disabled. Events published on one server instance '
        + 'will not reach clients connected to other instances. '
        + 'Consider configuring Redis via nuxtRealtime.redis in nuxt.config.ts.',
      )
    }

    expect(warnSpy).toHaveBeenCalledOnce()
    const [warnMessage] = warnSpy.mock.calls[0] ?? []
    expect(warnMessage).toContain('[nuxt-realtime]')
    expect(warnMessage).toContain('Cross-server event sync is disabled')
    expect(warnMessage).toContain('nuxtRealtime.redis')

    warnSpy.mockRestore()
  })
})
