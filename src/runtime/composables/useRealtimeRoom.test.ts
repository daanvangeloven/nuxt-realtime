import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { useRealtimeRoom } from './useRealtimeRoom'

let clientSocket: ClientSocket
vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $realtimeSocket: clientSocket,
    $realtimeConnectionId: { value: undefined },
  }),
  useRuntimeConfig: () => ({
    public: { nuxtRealtime: { logging: { level: 'silent' } } },
  }),
}))

// Minimal server-side reimplementation of room:join/room:leave plus enough of
// presence:*/lock:*/event:*/storage:* to exercise useRealtimeRoom's delegation.
function createRoomServer() {
  const roomMembers = new Map<string, Set<string>>()
  const presenceMembers = new Map<string, unknown>()
  const locks = new Map<string, string>()
  const lockInfo = new Map<string, unknown>()
  const values = new Map<string, unknown>()
  const httpServer = createServer()
  const io = new Server(httpServer)

  io.on('connection', (socket) => {
    socket.on('room:join', (roomId: string, callback?: (r: { success: boolean }) => void) => {
      (roomMembers.get(roomId) ?? roomMembers.set(roomId, new Set()).get(roomId)!).add(socket.id)
      socket.join(`room:${roomId}`)
      callback?.({ success: true })
    })

    socket.on('room:leave', (roomId: string, callback?: (r: { success: boolean }) => void) => {
      roomMembers.get(roomId)?.delete(socket.id)
      socket.leave(`room:${roomId}`)
      callback?.({ success: true })
    })

    socket.on('presence:join', ({ room, info }: { room: string, info?: unknown }, callback?: (r: { success: boolean }) => void) => {
      presenceMembers.set(`${room}:${socket.id}`, info ?? null)
      socket.join(`presence:${room}`)
      callback?.({ success: true })
    })

    socket.on('presence:subscribeRoom', (room: string, callback: (s: Record<string, unknown>) => void) => {
      const snapshot: Record<string, unknown> = {}
      for (const [k, v] of presenceMembers) {
        if (k.startsWith(`${room}:`)) snapshot[k.slice(room.length + 1)] = v
      }
      callback(snapshot)
    })

    socket.on('lock:claim', ({ key, room, ownerInfo }: { key: string, room?: string, ownerInfo?: unknown }, callback?: (r: { success: boolean, owned: boolean }) => void) => {
      const lockKey = room ? `${room}:${key}` : key
      const current = locks.get(lockKey)
      const owned = !current || current === socket.id
      if (owned) {
        locks.set(lockKey, socket.id)
        lockInfo.set(lockKey, ownerInfo ?? null)
      }
      callback?.({ success: true, owned })
    })

    socket.on('lock:subscribe', (key: string, callback?: (s: { key: string, owner: string | null }) => void) => {
      callback?.({ key, owner: locks.get(key) ?? null })
    })

    socket.on('lock:subscribeRoom', (room: string, callback: (s: Record<string, { owner: string, ownerInfo?: unknown }>) => void) => {
      const snapshot: Record<string, { owner: string, ownerInfo?: unknown }> = {}
      for (const [lockKey, owner] of locks) {
        if (lockKey.startsWith(`${room}:`)) {
          snapshot[lockKey.slice(room.length + 1)] = { owner, ownerInfo: lockInfo.get(lockKey) ?? null }
        }
      }
      callback(snapshot)
    })

    socket.on('storage:set', ({ key, value }: { key: string, value: unknown }, callback?: (r: { success: boolean }) => void) => {
      values.set(key, value)
      callback?.({ success: true })
    })

    socket.on('storage:get', (key: string, callback: (v: unknown) => void) => {
      callback(values.get(key) ?? null)
    })

    socket.on('event:subscribe', (channel: string) => {
      socket.join(`event:${channel}`)
    })
    socket.on('event:publish', ({ channel, data }: { channel: string, data: unknown }, callback?: (r: { success: boolean }) => void) => {
      socket.to(`event:${channel}`).emit('event:received', { channel, data })
      callback?.({ success: true })
    })
  })

  return { io, httpServer, roomMembers }
}

describe('useRealtimeRoom', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let serverPort: number
  let roomMembers: Map<string, Set<string>>

  beforeEach(async () => {
    ;({ io, httpServer, roomMembers } = createRoomServer())
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

  it('auto-joins the room on setup and reflects it in `joined`', async () => {
    const { joined } = useRealtimeRoom('project-42')
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(joined.value).toBe(true)
    expect(roomMembers.get('project-42')?.has(clientSocket.id!)).toBe(true)
  })

  it('leave() clears `joined` and removes membership', async () => {
    const { joined, leave } = useRealtimeRoom('project-42')
    await new Promise(resolve => setTimeout(resolve, 100))

    await leave()

    expect(joined.value).toBe(false)
    expect(roomMembers.get('project-42')?.has(clientSocket.id!)).toBe(false)
  })

  it('presence() scopes to this room without needing to pass the room again', async () => {
    const room = useRealtimeRoom('project-42')
    await new Promise<void>(resolve => clientSocket.emit('presence:join', { room: 'project-42', info: 'Alice' }, () => resolve()))

    const { members } = room.presence()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(Object.values(members.value)).toContain('Alice')
  })

  it('lock() scopes the key to this room, distinct from the same key in another room', async () => {
    const roomA = useRealtimeRoom('project-a')
    const roomB = useRealtimeRoom('project-b')

    const lockA = roomA.lock('doc-1')
    const lockB = roomB.lock('doc-1')

    const ownedA = await lockA.claim()
    const ownedB = await lockB.claim()

    expect(ownedA).toBe(true)
    expect(ownedB).toBe(true) // different room -> different underlying key, no conflict
  })

  it('locks() gives a bulk read-only snapshot of every lock tagged with this room', async () => {
    const room = useRealtimeRoom('project-42')
    await room.lock('doc-1', { ownerInfo: 'Alice' }).claim()
    await room.lock('doc-2', { ownerInfo: 'Bob' }).claim()

    const { locks } = room.locks()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(locks.value).toEqual({
      'doc-1': { owner: clientSocket.id, ownerInfo: 'Alice' },
      'doc-2': { owner: clientSocket.id, ownerInfo: 'Bob' },
    })
  })

  it('state() namespaces the key under the room id', async () => {
    const room = useRealtimeRoom('project-42')
    const count = room.state('count', 0)
    await new Promise(resolve => setTimeout(resolve, 100))

    count.value = 5
    await new Promise(resolve => setTimeout(resolve, 100))

    const raw = await new Promise(resolve => clientSocket.emit('storage:get', 'room:project-42:count', resolve))
    expect(raw).toBe(5)
  })

  it('events() namespaces the channel under the room id', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    other.emit('event:subscribe', 'project-42:chat')
    await new Promise(resolve => setTimeout(resolve, 50))

    const received: unknown[] = []
    other.on('event:received', data => received.push(data))

    const room = useRealtimeRoom('project-42')
    await room.events().publish('chat', { text: 'hi' })
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(received).toEqual([{ channel: 'project-42:chat', data: { text: 'hi' } }])
    other.close()
  })
})
