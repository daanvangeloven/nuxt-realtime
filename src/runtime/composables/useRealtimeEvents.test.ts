import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { useRealtimeEvents } from './useRealtimeEvents'

// Mock Nuxt app
let clientSocket: ClientSocket
vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $realtimeSocket: clientSocket,
  }),
}))

// Mock Vue's onUnmounted since we're not in a component context
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onUnmounted: vi.fn(),
  }
})

describe('useRealtimeEvents - Integration', () => {
  let io: Server
  let serverPort: number
  let httpServer: ReturnType<typeof createServer>

  beforeEach(async () => {
    // Create HTTP server and Socket.IO server
    httpServer = createServer()
    io = new Server(httpServer)

    // Set up socket.io handlers for events
    io.on('connection', (socket) => {
      socket.on('event:subscribe', (channel: string) => {
        socket.join(`event:${channel}`)
      })

      socket.on('event:unsubscribe', (channel: string) => {
        socket.leave(`event:${channel}`)
      })

      socket.on('event:publish', ({ channel, data, includeSelf }, callback) => {
        try {
          // Fan out to exact channel + all wildcard rooms (mirrors production server logic).
          // Using an array with .to() deduplicates recipients across rooms.
          const parts = channel.split(':')
          const rooms: string[] = [`event:${channel}`, 'event:*']
          for (let i = 1; i < parts.length; i++) {
            rooms.push(`event:${parts.slice(0, i).join(':')}:*`)
          }

          if (includeSelf) {
            io.to(rooms).emit('event:received', { channel, data })
          }
          else {
            socket.to(rooms).emit('event:received', { channel, data })
          }

          if (callback) {
            callback({ success: true })
          }
        }
        catch (error) {
          console.error('Event publish error:', error)
          if (callback) {
            callback({ success: false, error: 'Error while publishing event' })
          }
        }
      })
    })

    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port
        resolve()
      })
    })

    // Create client socket
    clientSocket = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      clientSocket.on('connect', () => resolve())
    })
  })

  afterEach(async () => {
    clientSocket.close()
    io.close()
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
    })
  })

  it('subscribes to a channel and receives events', async () => {
    const events = useRealtimeEvents()
    const receivedData: unknown[] = []

    events.subscribe('notifications', (data) => {
      receivedData.push(data)
    })

    // Wait for subscription to be processed
    await new Promise(resolve => setTimeout(resolve, 50))

    // Simulate another client publishing an event
    const anotherClient = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      anotherClient.on('connect', () => resolve())
    })

    // Subscribe to the channel from the other client (to join the room)
    anotherClient.emit('event:subscribe', 'notifications')
    await new Promise(resolve => setTimeout(resolve, 50))

    // Publish from the other client
    anotherClient.emit('event:publish', {
      channel: 'notifications',
      data: { type: 'info', message: 'Hello!' },
      includeSelf: false,
    })

    // Wait for the event to propagate
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(receivedData).toHaveLength(1)
    expect(receivedData[0]).toEqual({ type: 'info', message: 'Hello!' })

    anotherClient.close()
  })

  it('publish returns a promise that resolves on server acknowledgment', async () => {
    const events = useRealtimeEvents()

    // Subscribe first so there's a room to publish to
    events.subscribe('test-channel', () => {})
    await new Promise(resolve => setTimeout(resolve, 50))

    // Publish should resolve without error
    await expect(events.publish('test-channel', { test: 'data' })).resolves.toBeUndefined()
  })

  it('does not receive self-published events by default', async () => {
    const events = useRealtimeEvents()
    const receivedData: unknown[] = []

    events.subscribe('self-test', (data) => {
      receivedData.push(data)
    })

    // Wait for subscription
    await new Promise(resolve => setTimeout(resolve, 50))

    // Publish from same client
    await events.publish('self-test', { message: 'self message' })

    // Wait for potential event
    await new Promise(resolve => setTimeout(resolve, 100))

    // Should NOT receive own event
    expect(receivedData).toHaveLength(0)
  })

  it('receives self-published events when includeSelf is true', async () => {
    const events = useRealtimeEvents()
    const receivedData: unknown[] = []

    events.subscribe('self-test-include', (data) => {
      receivedData.push(data)
    })

    // Wait for subscription
    await new Promise(resolve => setTimeout(resolve, 50))

    // Publish with includeSelf
    await events.publish('self-test-include', { message: 'self message' }, { includeSelf: true })

    // Wait for event
    await new Promise(resolve => setTimeout(resolve, 100))

    // Should receive own event
    expect(receivedData).toHaveLength(1)
    expect(receivedData[0]).toEqual({ message: 'self message' })
  })

  it('unsubscribe removes subscription', async () => {
    const events = useRealtimeEvents()
    const receivedData: unknown[] = []

    events.subscribe('unsub-test', (data) => {
      receivedData.push(data)
    })

    // Wait for subscription
    await new Promise(resolve => setTimeout(resolve, 50))

    // Unsubscribe
    events.unsubscribe('unsub-test')

    // Wait for unsubscription
    await new Promise(resolve => setTimeout(resolve, 50))

    // Simulate event from another client
    const anotherClient = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      anotherClient.on('connect', () => resolve())
    })

    anotherClient.emit('event:subscribe', 'unsub-test')
    await new Promise(resolve => setTimeout(resolve, 50))

    anotherClient.emit('event:publish', {
      channel: 'unsub-test',
      data: { message: 'should not receive' },
      includeSelf: false,
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    // Should NOT receive event after unsubscribe
    expect(receivedData).toHaveLength(0)

    anotherClient.close()
  })

  it('returned unsubscribe function works correctly', async () => {
    const events = useRealtimeEvents()
    const receivedData: unknown[] = []

    const unsub = events.subscribe('func-unsub-test', (data) => {
      receivedData.push(data)
    })

    // Wait for subscription
    await new Promise(resolve => setTimeout(resolve, 50))

    // Use returned function to unsubscribe
    unsub()

    // Wait for unsubscription
    await new Promise(resolve => setTimeout(resolve, 50))

    // Try to receive event
    const anotherClient = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      anotherClient.on('connect', () => resolve())
    })

    anotherClient.emit('event:subscribe', 'func-unsub-test')
    await new Promise(resolve => setTimeout(resolve, 50))

    anotherClient.emit('event:publish', {
      channel: 'func-unsub-test',
      data: { message: 'should not receive' },
      includeSelf: false,
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(receivedData).toHaveLength(0)

    anotherClient.close()
  })

  it('supports multiple subscribers on the same channel', async () => {
    const events = useRealtimeEvents()
    const receivedData1: unknown[] = []
    const receivedData2: unknown[] = []

    events.subscribe('multi-sub', (data) => {
      receivedData1.push(data)
    })

    events.subscribe('multi-sub', (data) => {
      receivedData2.push(data)
    })

    // Wait for subscriptions
    await new Promise(resolve => setTimeout(resolve, 50))

    // Publish with includeSelf to test locally
    await events.publish('multi-sub', { message: 'to both' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    // Both callbacks should receive the event
    expect(receivedData1).toHaveLength(1)
    expect(receivedData2).toHaveLength(1)
    expect(receivedData1[0]).toEqual({ message: 'to both' })
    expect(receivedData2[0]).toEqual({ message: 'to both' })
  })

  it('partial unsubscribe keeps other subscribers active', async () => {
    const events = useRealtimeEvents()
    const receivedData1: unknown[] = []
    const receivedData2: unknown[] = []

    const unsub1 = events.subscribe('partial-unsub', (data) => {
      receivedData1.push(data)
    })

    events.subscribe('partial-unsub', (data) => {
      receivedData2.push(data)
    })

    // Wait for subscriptions
    await new Promise(resolve => setTimeout(resolve, 50))

    // Unsubscribe first callback
    unsub1()

    // Publish with includeSelf
    await events.publish('partial-unsub', { message: 'only second' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    // First should not receive, second should
    expect(receivedData1).toHaveLength(0)
    expect(receivedData2).toHaveLength(1)
  })

  it('receives events from multiple channels independently', async () => {
    const events = useRealtimeEvents()
    const channel1Data: unknown[] = []
    const channel2Data: unknown[] = []

    events.subscribe('channel-1', (data) => {
      channel1Data.push(data)
    })

    events.subscribe('channel-2', (data) => {
      channel2Data.push(data)
    })

    // Wait for subscriptions
    await new Promise(resolve => setTimeout(resolve, 50))

    // Publish to both channels
    await events.publish('channel-1', { channel: 1 }, { includeSelf: true })
    await events.publish('channel-2', { channel: 2 }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(channel1Data).toHaveLength(1)
    expect(channel1Data[0]).toEqual({ channel: 1 })

    expect(channel2Data).toHaveLength(1)
    expect(channel2Data[0]).toEqual({ channel: 2 })
  })

  // --- Wildcard matching ---

  it('namespace wildcard (chat:*) receives events from all chat: channels', async () => {
    const events = useRealtimeEvents()
    const received: Array<{ data: unknown, channel: string }> = []

    events.subscribe('chat:*', (data, actualChannel) => {
      received.push({ data, channel: actualChannel! })
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('chat:message', { text: 'hello' }, { includeSelf: true })
    await events.publish('chat:typing', { userId: '1' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(received).toHaveLength(2)
    expect(received[0]).toEqual({ data: { text: 'hello' }, channel: 'chat:message' })
    expect(received[1]).toEqual({ data: { userId: '1' }, channel: 'chat:typing' })
  })

  it('namespace wildcard does not receive events from other namespaces', async () => {
    const events = useRealtimeEvents()
    const chatReceived: unknown[] = []
    const notifReceived: unknown[] = []

    events.subscribe('chat:*', data => chatReceived.push(data))
    events.subscribe('notif:*', data => notifReceived.push(data))

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('chat:message', { text: 'hello' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(chatReceived).toHaveLength(1)
    expect(notifReceived).toHaveLength(0)
  })

  it('global wildcard (*) receives events from all channels', async () => {
    const events = useRealtimeEvents()
    const received: Array<{ data: unknown, channel: string }> = []

    events.subscribe('*', (data, actualChannel) => {
      received.push({ data, channel: actualChannel! })
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('chat:message', { text: 'hello' }, { includeSelf: true })
    await events.publish('notifications', { msg: 'alert' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(received).toHaveLength(2)
    expect(received.map(r => r.channel)).toEqual(['chat:message', 'notifications'])
  })

  it('exact subscriber and wildcard subscriber both receive the same event', async () => {
    const events = useRealtimeEvents()
    const exactReceived: unknown[] = []
    const wildcardReceived: unknown[] = []

    events.subscribe('chat:message', data => exactReceived.push(data))
    events.subscribe('chat:*', data => wildcardReceived.push(data))

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('chat:message', { text: 'hi' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(exactReceived).toHaveLength(1)
    expect(wildcardReceived).toHaveLength(1)
  })

  // --- Middleware ---

  it('middleware can block events from reaching subscribers', async () => {
    const blockAll: import('./useRealtimeEvents').EventMiddleware = (_event, _next) => {
      // never calls next — blocks the event
    }

    const events = useRealtimeEvents({ middleware: [blockAll] })
    const received: unknown[] = []

    events.subscribe('blocked-channel', data => received.push(data))

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('blocked-channel', { msg: 'should be blocked' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(received).toHaveLength(0)
  })

  it('middleware can transform event data before subscribers receive it', async () => {
    const transform: import('./useRealtimeEvents').EventMiddleware = (event, next) => {
      event.data = { ...(event.data as object), transformed: true }
      next()
    }

    const events = useRealtimeEvents({ middleware: [transform] })
    const received: unknown[] = []

    events.subscribe('transform-channel', data => received.push(data))

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('transform-channel', { original: true }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ original: true, transformed: true })
  })

  it('middleware runs in order and each must call next to continue', async () => {
    const order: number[] = []

    const first: import('./useRealtimeEvents').EventMiddleware = (event, next) => {
      order.push(1)
      next()
    }
    const second: import('./useRealtimeEvents').EventMiddleware = (event, next) => {
      order.push(2)
      next()
    }

    const events = useRealtimeEvents({ middleware: [first, second] })
    const received: unknown[] = []

    events.subscribe('ordered-channel', data => received.push(data))

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('ordered-channel', { msg: 'test' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(order).toEqual([1, 2])
    expect(received).toHaveLength(1)
  })

  // --- Type-safe events (runtime behaviour; compile-time checks are in the type definitions) ---

  it('type-safe event map constrains publish and subscribe at runtime', async () => {
    interface AppEvents {
      'user:login': { userId: string }
      'user:logout': { userId: string }
    }

    const events = useRealtimeEvents<AppEvents>()
    const received: unknown[] = []

    events.subscribe('user:login', data => received.push(data))

    await new Promise(resolve => setTimeout(resolve, 50))

    await events.publish('user:login', { userId: 'abc' }, { includeSelf: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ userId: 'abc' })
  })
})
