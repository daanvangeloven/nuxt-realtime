import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineNitroPlugin, useStorage, useRuntimeConfig } from 'nitropack/runtime'
import { Server as Engine } from 'engine.io'
import { Server } from 'socket.io'
import { defineEventHandler } from 'h3'

// Nitro/h3/crossws don't expose typed access to the underlying Node.js objects,
// but Engine.IO requires them. These interfaces document the internal properties we rely on.
interface NodeEvent {
  node: { req: IncomingMessage, res: ServerResponse }
  _handled: boolean
}

interface WebSocketPeer {
  _internal: { nodeReq: IncomingMessage & { socket: Duplex } }
  websocket: WebSocket
}

// Engine.IO's prepare() and onWebSocket() are private in its type definitions,
// but are needed to bridge Nitro's WebSocket handling with Engine.IO.
interface EngineWithInternals {
  prepare: (req: IncomingMessage) => void
  onWebSocket: (req: IncomingMessage, socket: Duplex, websocket: WebSocket) => void
}

export default defineNitroPlugin((nitroApp) => {
  const io = new Server()
  const engine = new Engine()
  const storage = useStorage('nuxt-realtime')
  const config = useRuntimeConfig()
  const cleanupConfig = (config.public.nuxtRealtime as { cleanup: { heartbeatInterval: number, cleanupInterval: number, idleThreshold: number } | false }).cleanup

  async function touchLease(key: string) {
    await storage.setItem(`_lease:${key}`, { lastSeen: Date.now() })
  }

  io.bind(engine)

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    // Storage operations
    socket.on('storage:get', async (key: string, callback) => {
      const value = await storage.getItem(key)
      callback(value)
    })

    socket.on('storage:set', async ({ key, value }, callback) => {
      try {
        await storage.setItem(key, value)
        await touchLease(key)
        socket.to(`key:${key}`).emit('storage:updated', { key, value })

        if (callback) {
          callback({
            success: true,
            status: 'ok',
          })
        }
      }
      catch (error) {
        console.error('Storage set error:', error)
        if (callback) {
          callback({
            success: false,
            error: 'Error while updating storage value',
          })
        }
      }
    })

    socket.on('storage:subscribe', async (key: string) => {
      socket.join(`key:${key}`)
      await touchLease(key)
    })

    socket.on('storage:unsubscribe', (key: string) => {
      socket.leave(`key:${key}`)
    })

    socket.on('storage:heartbeat', async () => {
      // Touch leases for all keys this socket is subscribed to
      const storageRooms = [...socket.rooms].filter(r => r.startsWith('key:'))
      await Promise.all(storageRooms.map(room => touchLease(room.slice('key:'.length))))
    })

    // Event pub/sub operations
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
          // Broadcast to all in room including sender
          io.to(room).emit('event:received', { channel, data })
        }
        else {
          // Broadcast to all in room except sender
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

  // Cleanup job
  if (cleanupConfig) {
    const { cleanupInterval, idleThreshold } = cleanupConfig

    // Add jitter (±10%) so multiple servers don't all scan at the same instant
    const jitter = cleanupInterval * 0.1
    const interval = cleanupInterval + Math.random() * jitter * 2 - jitter

    setInterval(async () => {
      try {
        const allKeys = await storage.getKeys()
        const leaseKeys = allKeys.filter(k => k.startsWith('_lease:'))

        for (const leaseKey of leaseKeys) {
          const lease = await storage.getItem<{ lastSeen: number }>(leaseKey)
          if (lease && Date.now() - lease.lastSeen > idleThreshold) {
            const dataKey = leaseKey.slice('_lease:'.length)
            await storage.removeItem(leaseKey)
            await storage.removeItem(dataKey)
            console.log(`[nuxt-realtime] Cleaned up idle key: ${dataKey}`)
          }
        }
      }
      catch (error) {
        console.error('[nuxt-realtime] Cleanup job error:', error)
      }
    }, interval)
  }

  const engineWithInternals = engine as unknown as EngineWithInternals
  // There currently is no better way to use socket.io with crossws
  // https://socket.io/how-to/use-with-nuxt#hook-the-socketio-server
  // https://github.com/h3js/crossws/issues/138
  nitroApp.router.use('/socket.io/', defineEventHandler({
    handler(event: unknown) {
      const nodeEvent = event as unknown as NodeEvent
      engine.handleRequest(nodeEvent.node.req as Parameters<Engine['handleRequest']>[0], nodeEvent.node.res)
      nodeEvent._handled = true
    },
    websocket: {
      open(peer: unknown) {
        const { _internal, websocket } = peer as unknown as WebSocketPeer
        engineWithInternals.prepare(_internal.nodeReq)
        engineWithInternals.onWebSocket(_internal.nodeReq, _internal.nodeReq.socket, websocket)
      },
    },
  }))
})
