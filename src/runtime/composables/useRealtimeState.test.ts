import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { useRealtimeState } from './useRealtimeState'

// Mock Nuxt app
let clientSocket: ClientSocket
vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $realtimeSocket: clientSocket,
  }),
  useRuntimeConfig: () => ({
    public: { nuxtRealtime: { logging: { level: 'silent' } } },
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

function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout
    const check = () => {
      if (condition()) return resolve()
      if (Date.now() > deadline) return reject(new Error('waitFor timed out'))
      setTimeout(check, 10)
    }
    check()
  })
}

describe('useRealtimeState - Integration', () => {
  let io: Server
  let serverPort: number
  let httpServer: ReturnType<typeof createServer>

  beforeEach(async () => {
    // Create HTTP server and Socket.IO server
    httpServer = createServer()
    io = new Server(httpServer)
    const storage = new Map<string, unknown>()

    // Set up socket.io handlers
    io.on('connection', (socket) => {
      socket.on('storage:get', async (key: string, callback) => {
        const value = storage.get(key) ?? null
        callback(value)
      })

      socket.on('storage:set', async ({ key, value }, callback) => {
        try {
          storage.set(key, value)
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

    await waitFor(() => !data.loading.value)

    expect(data.loading.value).toBe(false)
    // Since there's no value on server, it should keep the default
    expect(data.value).toBe('default-value')
  })

  it('updates value on the server and receives confirmation', async () => {
    const data = useRealtimeState('test-key-2', 'initial')

    await waitFor(() => !data.loading.value)

    // Update the value — optimistically applied immediately
    data.value = 'updated'

    expect(data.value).toBe('updated')
  })

  it('receives updates from other clients', async () => {
    const data = useRealtimeState<string>('shared-key', 'initial')

    await waitFor(() => !data.loading.value)

    const anotherClient = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>((resolve) => {
      anotherClient.on('connect', () => resolve())
    })

    // Await the set ack so we know the server has broadcast storage:updated
    await new Promise<void>(resolve =>
      anotherClient.emit('storage:set', { key: 'shared-key', value: 'from-another-client' }, resolve),
    )

    await waitFor(() => data.value === 'from-another-client')

    expect(data.value).toBe('from-another-client')

    anotherClient.close()
  })

  it('fetches existing value from server without default value', async () => {
    // First, set a value on the server
    await new Promise<void>(resolve =>
      clientSocket.emit('storage:set', { key: 'existing-key', value: 'server-value' }, resolve),
    )

    // Now create a new realtime state without a default value
    const data = useRealtimeState<string>('existing-key')

    expect(data.loading.value).toBe(true)

    await waitFor(() => !data.loading.value)

    expect(data.loading.value).toBe(false)
    expect(data.value).toBe('server-value')
  })

  it('server value overrides default value when joining existing channel', async () => {
    // First, set a value on the server
    await new Promise<void>(resolve =>
      clientSocket.emit('storage:set', { key: 'override-key', value: 'server-value' }, resolve),
    )

    // Now create a new realtime state with a default value
    const data = useRealtimeState('override-key', 'default-value')

    expect(data.value).toBe('default-value') // Initially has default

    await waitFor(() => !data.loading.value)

    expect(data.loading.value).toBe(false)
    // Server value should override the default
    expect(data.value).toBe('server-value')
  })
})

describe('useRealtimeState - debounced sync', () => {
  let io: Server
  let serverPort: number
  let httpServer: ReturnType<typeof createServer>
  let setCallCount: number

  beforeEach(async () => {
    setCallCount = 0
    httpServer = createServer()
    io = new Server(httpServer)
    const storage = new Map<string, unknown>()

    io.on('connection', (socket) => {
      socket.on('storage:get', async (key: string, callback) => {
        callback(storage.get(key) ?? null)
      })

      socket.on('storage:set', async ({ key, value }, callback) => {
        setCallCount++
        storage.set(key, value)
        socket.to(`key:${key}`).emit('storage:updated', { key, value })
        callback({ success: true, status: 'ok' })
      })

      socket.on('storage:subscribe', (key: string) => {
        socket.join(`key:${key}`)
      })

      socket.on('storage:unsubscribe', (key: string) => {
        socket.leave(`key:${key}`)
      })
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port
        resolve()
      })
    })

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

  it('buffers rapid changes and only sends one server update', async () => {
    const data = useRealtimeState('debounce-key', 'initial', {
      sync: 'debounced',
      debounceMs: 100,
    })

    await waitFor(() => !data.loading.value)

    // Rapid consecutive updates
    data.value = 'a'
    data.value = 'b'
    data.value = 'c'

    // Value is optimistically updated immediately
    expect(data.value).toBe('c')

    // Before debounce fires, server has not been called for these updates
    expect(setCallCount).toBe(0)

    // Wait for debounce to fire
    await new Promise(resolve => setTimeout(resolve, 200))

    // Only one server call for the last value
    expect(setCallCount).toBe(1)
    expect(data.value).toBe('c')
  })

  it('resets debounce timer on each new value', async () => {
    const data = useRealtimeState('debounce-reset-key', 'initial', {
      sync: 'debounced',
      debounceMs: 100,
    })

    await waitFor(() => !data.loading.value)

    data.value = 'first'
    await new Promise(resolve => setTimeout(resolve, 50))
    data.value = 'second' // resets timer

    await new Promise(resolve => setTimeout(resolve, 50))
    // Timer not fired yet (only 50ms since last set)
    expect(setCallCount).toBe(0)

    await new Promise(resolve => setTimeout(resolve, 100))
    // Now fired
    expect(setCallCount).toBe(1)
    expect(data.value).toBe('second')
  })
})

describe('useRealtimeState - manual sync', () => {
  let io: Server
  let serverPort: number
  let httpServer: ReturnType<typeof createServer>
  let serverStorage: Map<string, unknown>

  beforeEach(async () => {
    serverStorage = new Map()
    httpServer = createServer()
    io = new Server(httpServer)

    io.on('connection', (socket) => {
      socket.on('storage:get', async (key: string, callback) => {
        callback(serverStorage.get(key) ?? null)
      })

      socket.on('storage:set', async ({ key, value }, callback) => {
        serverStorage.set(key, value)
        socket.to(`key:${key}`).emit('storage:updated', { key, value })
        if (callback) {
          callback({ success: true, status: 'ok' })
        }
      })

      socket.on('storage:subscribe', (key: string) => {
        socket.join(`key:${key}`)
      })

      socket.on('storage:unsubscribe', (key: string) => {
        socket.leave(`key:${key}`)
      })
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port
        resolve()
      })
    })

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

  it('does not sync to server on value change', async () => {
    const data = useRealtimeState('manual-key', 'initial', { sync: 'manual' })

    await waitFor(() => !data.loading.value)

    data.value = 'changed'

    // Manual sync — give any accidental emit a chance to arrive before asserting
    await new Promise(resolve => setTimeout(resolve, 20))

    // Local value updated
    expect(data.value).toBe('changed')
    // Server still has no value
    expect(serverStorage.get('manual-key')).toBeUndefined()
  })

  it('marks isDirty when value changes', async () => {
    const data = useRealtimeState('dirty-key', 'initial', { sync: 'manual' })

    await waitFor(() => !data.loading.value)

    expect(data.isDirty.value).toBe(false)

    data.value = 'changed'

    expect(data.isDirty.value).toBe(true)
  })

  it('syncs to server and clears isDirty when sync() is called', async () => {
    const data = useRealtimeState('sync-call-key', 'initial', { sync: 'manual' })

    await waitFor(() => !data.loading.value)

    data.value = 'updated'
    expect(data.isDirty.value).toBe(true)

    data.sync()

    await waitFor(() => serverStorage.get('sync-call-key') === 'updated')

    expect(serverStorage.get('sync-call-key')).toBe('updated')
    expect(data.isDirty.value).toBe(false)
  })

  it('clears isDirty when server broadcasts an update', async () => {
    const data = useRealtimeState<string>('conflict-key', 'initial', { sync: 'manual' })

    await waitFor(() => !data.loading.value)

    data.value = 'local-change'
    expect(data.isDirty.value).toBe(true)

    // Another client pushes a new value
    const anotherClient = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => anotherClient.on('connect', () => resolve()))

    await new Promise<void>(resolve =>
      anotherClient.emit('storage:set', { key: 'conflict-key', value: 'server-value' }, resolve),
    )

    await waitFor(() => data.value === 'server-value')

    expect(data.value).toBe('server-value')
    expect(data.isDirty.value).toBe(false)

    anotherClient.close()
  })

  it('isDirty starts as false', async () => {
    const data = useRealtimeState('fresh-key', 'initial', { sync: 'manual' })
    expect(data.isDirty.value).toBe(false)
  })
})
