import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Server } from 'socket.io'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'socket.io-client'

let hookHandlers: Array<(ctx: { auth: Record<string, unknown> }) => void | Promise<void>>
let mockSocketUrl: string
let loggerErrorSpy: ReturnType<typeof vi.fn>

vi.mock('#app', () => ({
  defineNuxtPlugin: (factory: (nuxtApp: unknown) => unknown) => factory,
  useRuntimeConfig: () => ({
    public: {
      nuxtRealtime: {
        socketUrl: mockSocketUrl,
        socketPath: undefined,
        cleanup: false,
        logging: { level: 'silent' },
      },
    },
  }),
}))

vi.mock('./composables/useRealtimeLogger', () => ({
  useRealtimeLogger: () => ({
    debug: vi.fn(),
    error: loggerErrorSpy,
  }),
}))

describe('plugin.client - auth passthrough', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let capturedAuth: Record<string, unknown> | undefined

  beforeEach(async () => {
    vi.resetModules()
    hookHandlers = []
    capturedAuth = undefined
    loggerErrorSpy = vi.fn()

    httpServer = createServer()
    io = new Server(httpServer)
    io.use((socket, next) => {
      capturedAuth = socket.handshake.auth as Record<string, unknown>
      next()
    })
    io.on('connection', () => {})

    const port = await new Promise<number>(resolve => httpServer.listen(0, () => {
      resolve((httpServer.address() as AddressInfo).port)
    }))
    mockSocketUrl = `http://localhost:${port}`
  })

  afterEach(async () => {
    io.close()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  })

  async function loadPlugin(): Promise<Socket> {
    const { default: pluginFactory } = await import('./plugin.client')
    const nuxtApp = {
      hooks: {
        callHook: vi.fn(async (name: string, ctx: unknown) => {
          if (name === 'nuxt-realtime:auth') {
            for (const handler of hookHandlers) {
              await handler(ctx as { auth: Record<string, unknown> })
            }
          }
        }),
      },
    }
    const result = (pluginFactory as unknown as (app: unknown) => { provide: { realtimeSocket: Socket } })(nuxtApp)
    return result.provide.realtimeSocket
  }

  it('connects with empty auth when no hook is registered', async () => {
    const socket = await loadPlugin()
    await new Promise<void>(resolve => socket.on('connect', resolve))

    expect(capturedAuth).toEqual({})

    socket.close()
  })

  it('forwards auth data set by a registered nuxt-realtime:auth hook', async () => {
    hookHandlers.push((ctx) => {
      ctx.auth.token = 'test-token'
    })

    const socket = await loadPlugin()
    await new Promise<void>(resolve => socket.on('connect', resolve))

    expect(capturedAuth).toEqual({ token: 'test-token' })

    socket.close()
  })

  it('logs and still connects when the auth hook throws', async () => {
    hookHandlers.push(() => {
      throw new Error('boom')
    })

    const socket = await loadPlugin()
    await new Promise<void>(resolve => socket.on('connect', resolve))

    expect(capturedAuth).toEqual({})
    expect(loggerErrorSpy).toHaveBeenCalledWith('nuxt-realtime:auth hook failed:', expect.any(Error))

    socket.close()
  })
})
