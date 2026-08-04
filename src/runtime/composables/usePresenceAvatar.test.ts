import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { usePresenceAvatar } from './usePresenceAvatar'
import type { PresenceSnapshot } from '../types'

let clientSocket: ClientSocket
vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $realtimeSocket: clientSocket,
  }),
}))

// Minimal server-side reimplementation of the presence:* handlers from socketio.ts.
function createPresenceServer() {
  const members = new Map<string, unknown>()
  const httpServer = createServer()
  const io = new Server(httpServer)

  io.on('connection', (socket) => {
    const connectionId = (socket.handshake.auth?.connectionId as string | undefined) ?? socket.id

    socket.on('presence:join', ({ room, info }: { room: string, info?: unknown }, callback?: (r: { success: boolean }) => void) => {
      members.set(connectionId, info ?? null)
      socket.join(`presence:${room}`)
      socket.to(`presence:${room}`).emit('presence:changed', { room, connectionId, info: info ?? null })
      callback?.({ success: true })
    })

    socket.on('presence:leave', ({ room }: { room: string }, callback?: (r: { success: boolean }) => void) => {
      const existed = members.has(connectionId)
      members.delete(connectionId)
      socket.leave(`presence:${room}`)
      if (existed) {
        socket.to(`presence:${room}`).emit('presence:changed', { room, connectionId, info: null })
      }
      callback?.({ success: true })
    })

    socket.on('presence:subscribeRoom', (room: string, callback: (s: PresenceSnapshot) => void) => {
      socket.join(`presence:${room}`)
      callback(Object.fromEntries(members))
    })
  })

  return { io, httpServer }
}

describe('usePresenceAvatar', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer } = createPresenceServer())
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port
        resolve()
      })
    })
    clientSocket = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => clientSocket.on('connect', () => resolve()))
  })

  afterEach(async () => {
    clientSocket.close()
    io.close()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  })

  it('is offline with no info when the member is not present', async () => {
    const { online, info } = usePresenceAvatar({ room: 'project-42', connectionId: 'bob' })
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(online.value).toBe(false)
    expect(info.value).toBeUndefined()
  })

  it('goes online and derives initials once the member joins', async () => {
    const { online, info, initials } = usePresenceAvatar({ room: 'project-42', connectionId: 'bob' })
    await new Promise(resolve => setTimeout(resolve, 100))

    const other = ioClient(`http://localhost:${serverPort}`, { auth: { connectionId: 'bob' } })
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('presence:join', { room: 'project-42', info: { name: 'Bob Ross' } }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(online.value).toBe(true)
    expect(info.value).toEqual({ name: 'Bob Ross' })
    expect(initials.value).toBe('BR')

    other.close()
  })

  it('falls back to a single-word initials for a one-word name', async () => {
    usePresenceAvatar({ room: 'project-42', connectionId: 'bob' })

    const other = ioClient(`http://localhost:${serverPort}`, { auth: { connectionId: 'bob' } })
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    const { initials } = usePresenceAvatar({ room: 'project-42', connectionId: 'bob' })
    await new Promise<void>(resolve => other.emit('presence:join', { room: 'project-42', info: { name: 'Bob' } }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(initials.value).toBe('BO')
    other.close()
  })

  it('goes offline again once the member leaves', async () => {
    const other = ioClient(`http://localhost:${serverPort}`, { auth: { connectionId: 'bob' } })
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('presence:join', { room: 'project-42', info: { name: 'Bob' } }, () => resolve()))

    const { online } = usePresenceAvatar({ room: 'project-42', connectionId: 'bob' })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(online.value).toBe(true)

    await new Promise<void>(resolve => other.emit('presence:leave', { room: 'project-42' }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(online.value).toBe(false)
    other.close()
  })
})
