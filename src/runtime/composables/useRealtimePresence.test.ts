import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { useRealtimePresence } from './useRealtimePresence'
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

  return { io, httpServer, members }
}

describe('useRealtimePresence', () => {
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

  it('starts empty when no one else is present', async () => {
    const { members } = useRealtimePresence('project-42')
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(members.value).toEqual({})
  })

  it('auto-joins when info is given and reflects itself in members via another client', async () => {
    useRealtimePresence('project-42', { info: { name: 'Alice' } })
    await new Promise(resolve => setTimeout(resolve, 100))

    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    const snapshot = await new Promise<PresenceSnapshot>(resolve =>
      other.emit('presence:subscribeRoom', 'project-42', resolve),
    )

    expect(Object.values(snapshot)).toEqual([{ name: 'Alice' }])
    other.close()
  })

  it('does not join when no info is given, only observes', async () => {
    useRealtimePresence('project-42')
    await new Promise(resolve => setTimeout(resolve, 100))

    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    const snapshot = await new Promise<PresenceSnapshot>(resolve =>
      other.emit('presence:subscribeRoom', 'project-42', resolve),
    )

    expect(snapshot).toEqual({})
    other.close()
  })

  it('reflects another client joining the room live', async () => {
    const { members } = useRealtimePresence('project-42')
    await new Promise(resolve => setTimeout(resolve, 100))

    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('presence:join', { room: 'project-42', info: 'Bob' }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(Object.values(members.value)).toEqual(['Bob'])
    other.close()
  })

  it('removes a member from members when they leave', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('presence:join', { room: 'project-42', info: 'Bob' }, () => resolve()))

    const { members } = useRealtimePresence('project-42')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(Object.keys(members.value)).toHaveLength(1)

    await new Promise<void>(resolve => other.emit('presence:leave', { room: 'project-42' }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(members.value).toEqual({})
    other.close()
  })

  it('join()/leave() round-trip explicitly', async () => {
    const { join, leave } = useRealtimePresence('project-42')
    await join()

    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    const snapshotAfterJoin = await new Promise<PresenceSnapshot>(resolve =>
      other.emit('presence:subscribeRoom', 'project-42', resolve),
    )
    expect(Object.keys(snapshotAfterJoin)).toHaveLength(1)

    await leave()
    const snapshotAfterLeave = await new Promise<PresenceSnapshot>(resolve =>
      other.emit('presence:subscribeRoom', 'project-42', resolve),
    )
    expect(snapshotAfterLeave).toEqual({})

    other.close()
  })
})
