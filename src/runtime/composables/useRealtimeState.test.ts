import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createStorage } from 'unstorage'
import { useRealtimeState } from './useRealtimeState'

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

describe('useRealtimeState - Integration', () => {
  let io: Server
  let serverPort: number
  let httpServer: ReturnType<typeof createServer>

  beforeEach(async () => {
    // Create HTTP server and Socket.IO server
    httpServer = createServer()
    io = new Server(httpServer)
    const storage = createStorage()

    // Set up socket.io handlers
    io.on('connection', (socket) => {
      socket.on('storage:get', async (key: string, callback) => {
        const value = await storage.getItem(key)
        callback(value)
      })

      socket.on('storage:set', async ({ key, value }, callback) => {
        try {
          await storage.setItem(key, value)
          socket.to(`key:${key}`).emit('storage:updated', { key, value })
          if (callback) {
            callback({ success: true, status: 'ok' })
          }
        }
        catch (error) {
          console.error('Storage set error:', error)
          if (callback) {
            callback({ success: false, error: 'Error while updating storage value' })
          }
        }
      })

      socket.on('storage:subscribe', (key: string) => {
        socket.join(`key:${key}`)
      })

      socket.on('storage:unsubscribe', (key: string) => {
        socket.leave(`key:${key}`)
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

  it('fetches initial value from server', async () => {
    const data = useRealtimeState('test-key', 'default-value')

    expect(data.loading.value).toBe(true)

    // Wait for the initial fetch to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(data.loading.value).toBe(false)
    // Since there's no value on server, it should keep the default
    expect(data.value).toBe('default-value')
  })

  it('updates value on the server and receives confirmation', async () => {
    const data = useRealtimeState('test-key-2', 'initial')

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100))

    // Update the value
    data.value = 'updated'

    // Wait for the update to propagate
    await new Promise(resolve => setTimeout(resolve, 100))

    // Value should be optimistically updated
    expect(data.value).toBe('updated')
  })

  it('receives updates from other clients', async () => {
    const data = useRealtimeState<string>('shared-key', 'initial')

    // Wait for initialization and subscription
    await new Promise(resolve => setTimeout(resolve, 100))

    // Simulate another client updating the value
    const anotherClient = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      anotherClient.on('connect', () => resolve())
    })

    // Update from the other client
    anotherClient.emit('storage:set', { key: 'shared-key', value: 'from-another-client' })

    // Wait for the update to propagate
    await new Promise(resolve => setTimeout(resolve, 150))

    expect(data.value).toBe('from-another-client')

    anotherClient.close()
  })

  it('fetches existing value from server without default value', async () => {
    // First, set a value on the server
    await new Promise<void>((resolve) => {
      clientSocket.emit('storage:set', { key: 'existing-key', value: 'server-value' }, () => {
        resolve()
      })
    })

    // Wait for the value to be set
    await new Promise(resolve => setTimeout(resolve, 50))

    // Now create a new realtime state without a default value
    const data = useRealtimeState<string>('existing-key')

    expect(data.loading.value).toBe(true)

    // Wait for the initial fetch to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(data.loading.value).toBe(false)
    expect(data.value).toBe('server-value')
  })

  it('server value overrides default value when joining existing channel', async () => {
    // First, set a value on the server
    await new Promise<void>((resolve) => {
      clientSocket.emit('storage:set', { key: 'override-key', value: 'server-value' }, () => {
        resolve()
      })
    })

    // Wait for the value to be set
    await new Promise(resolve => setTimeout(resolve, 50))

    // Now create a new realtime state with a default value
    const data = useRealtimeState('override-key', 'default-value')

    expect(data.value).toBe('default-value') // Initially has default

    // Wait for the initial fetch to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(data.loading.value).toBe(false)
    // Server value should override the default
    expect(data.value).toBe('server-value')
  })
})
