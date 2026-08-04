import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { useRealtimeLockRoom } from './useRealtimeLockRoom'
import type { LockRoomSnapshot } from '../types'

let clientSocket: ClientSocket
vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $realtimeSocket: clientSocket,
  }),
}))

// Minimal server-side reimplementation of lock:subscribeRoom/lock:changed for a fixed room.
function createRoomServer(initialSnapshot: LockRoomSnapshot) {
  const httpServer = createServer()
  const io = new Server(httpServer)

  io.on('connection', (socket) => {
    socket.on('lock:subscribeRoom', (room: string, callback: (s: LockRoomSnapshot) => void) => {
      socket.join(`lockroom:${room}`)
      callback(initialSnapshot)
    })
    socket.on('lock:unsubscribeRoom', (room: string) => {
      socket.leave(`lockroom:${room}`)
    })
  })

  return { io, httpServer }
}

describe('useRealtimeLockRoom', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer } = createRoomServer({ 'doc-1': { owner: 'conn-1', ownerInfo: null } }))
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

  it('fetches the initial snapshot on subscribe', async () => {
    const { locks } = useRealtimeLockRoom('project-42')
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(locks.value).toEqual({ 'doc-1': { owner: 'conn-1', ownerInfo: null } })
  })

  it('applies a live claim diff for the subscribed room', async () => {
    const { locks } = useRealtimeLockRoom('project-42')
    await new Promise(resolve => setTimeout(resolve, 50))

    io.to('lockroom:project-42').emit('lock:changed', { key: 'doc-2', owner: 'conn-2', ownerInfo: 'Bob', room: 'project-42' })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(locks.value).toEqual({
      'doc-1': { owner: 'conn-1', ownerInfo: null },
      'doc-2': { owner: 'conn-2', ownerInfo: 'Bob' },
    })
  })

  it('removes a key from the snapshot on a release diff', async () => {
    const { locks } = useRealtimeLockRoom('project-42')
    await new Promise(resolve => setTimeout(resolve, 50))

    io.to('lockroom:project-42').emit('lock:changed', { key: 'doc-1', owner: null, room: 'project-42' })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(locks.value).toEqual({})
  })

  it('ignores lock:changed events for a different room', async () => {
    const { locks } = useRealtimeLockRoom('project-42')
    await new Promise(resolve => setTimeout(resolve, 50))

    io.to('lockroom:other-room').emit('lock:changed', { key: 'doc-9', owner: 'conn-9', room: 'other-room' })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(locks.value).toEqual({ 'doc-1': { owner: 'conn-1', ownerInfo: null } })
  })
})
