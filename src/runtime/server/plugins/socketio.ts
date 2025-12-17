import { defineNitroPlugin } from 'nitropack/runtime'
import { Server as Engine } from 'engine.io'
import { Server } from 'socket.io'
import { createStorage } from 'unstorage'
import { defineEventHandler } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  const io = new Server()
  const engine = new Engine()
  const storage = createStorage()

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
  })

  nitroApp.router.use('/socket.io/', defineEventHandler({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler(event: any) {
      engine.handleRequest(event.node.req, event.node.res)
      event._handled = true
    },
    websocket: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      open(peer: any) {
        // @ts-expect-error private method and property
        engine.prepare(peer._internal.nodeReq)
        // @ts-expect-error private method and property
        engine.onWebSocket(peer._internal.nodeReq, peer._internal.nodeReq.socket, peer.websocket)
      },
    },
  }))
})
