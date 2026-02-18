import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineNitroPlugin, useStorage } from 'nitropack/runtime'
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

    socket.on('storage:subscribe', (key: string) => {
      socket.join(`key:${key}`)
    })

    socket.on('storage:unsubscribe', (key: string) => {
      socket.leave(`key:${key}`)
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

  const engineWithInternals = engine as unknown as EngineWithInternals
  // There currently is no better way to use socket.io with crossws
  // https://socket.io/how-to/use-with-nuxt#hook-the-socketio-server
  // https://github.com/h3js/crossws/issues/138
  nitroApp.router.use('/socket.io/', defineEventHandler({
    handler(event) {
      const nodeEvent = event as unknown as NodeEvent
      engine.handleRequest(nodeEvent.node.req as Parameters<Engine['handleRequest']>[0], nodeEvent.node.res)
      nodeEvent._handled = true
    },
    websocket: {
      open(peer) {
        const { _internal, websocket } = peer as unknown as WebSocketPeer
        engineWithInternals.prepare(_internal.nodeReq)
        engineWithInternals.onWebSocket(_internal.nodeReq, _internal.nodeReq.socket, websocket)
      },
    },
  }))
})
