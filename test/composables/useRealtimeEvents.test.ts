import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { useRealtimeEvents } from '../../src/runtime/composables/useRealtimeEvents'

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
          const room = `event:${channel}`

          if (includeSelf) {
            io.to(room).emit('event:received', { channel, data })
          }
          else {
            socket.to(room).emit('event:received', { channel, data })
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
})
