import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Server } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { onUnmounted } from 'vue'
import { useRealtimeLock } from './useRealtimeLock'

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

// Mock Vue's onUnmounted since we're not in a component context. Capturing the calls lets tests
// simulate an unmount by invoking the registered callback directly.
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onUnmounted: vi.fn(),
  }
})

function triggerUnmount() {
  const callback = vi.mocked(onUnmounted).mock.calls.at(-1)?.[0]
  callback?.()
}

// Minimal server-side reimplementation of the lock:* handlers from socketio.ts
function createLockServer() {
  const locks = new Map<string, string>()
  const infos = new Map<string, unknown>()
  const httpServer = createServer()
  const io = new Server(httpServer)

  io.on('connection', (socket) => {
    socket.on('lock:claim', (
      { key, ownerInfo }: { key: string, ownerInfo?: unknown },
      callback?: (r: { success: boolean, owned: boolean }) => void,
    ) => {
      const current = locks.get(key)
      const owned = !current || current === socket.id
      if (owned) {
        locks.set(key, socket.id)
        infos.set(key, ownerInfo ?? null)
        socket.to(`lock:${key}`).emit('lock:changed', { key, owner: socket.id, ownerInfo: ownerInfo ?? null })
      }
      callback?.({ success: true, owned })
    })

    socket.on('lock:release', (
      { key, changed }: { key: string, changed?: boolean },
      callback?: (r: { success: boolean }) => void,
    ) => {
      const released = locks.get(key) === socket.id
      if (released) {
        locks.delete(key)
        infos.delete(key)
        socket.to(`lock:${key}`).emit('lock:changed', { key, owner: null, changed: changed ?? false })
      }
      callback?.({ success: released })
    })

    socket.on('lock:subscribe', (key: string, callback?: (s: { key: string, owner: string | null, ownerInfo: unknown }) => void) => {
      socket.join(`lock:${key}`)
      callback?.({ key, owner: locks.get(key) ?? null, ownerInfo: infos.get(key) ?? null })
    })

    socket.on('lock:unsubscribe', (key: string) => {
      socket.leave(`lock:${key}`)
    })
  })

  return { io, httpServer, locks }
}

describe('useRealtimeLock', () => {
  let io: Server
  let httpServer: ReturnType<typeof createServer>
  let serverPort: number

  beforeEach(async () => {
    ;({ io, httpServer } = createLockServer())
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

  it('starts unlocked and not owned', async () => {
    const lock = useRealtimeLock('doc-1')
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(lock.locked.value).toBe(false)
    expect(lock.ownedByMe.value).toBe(false)
  })

  it('claim() succeeds when free and marks ownedByMe and locked', async () => {
    const lock = useRealtimeLock('doc-2')
    const owned = await lock.claim()

    expect(owned).toBe(true)
    expect(lock.ownedByMe.value).toBe(true)
    expect(lock.locked.value).toBe(true)
  })

  it('claim() is idempotent for the same client', async () => {
    const lock = useRealtimeLock('doc-3')
    await lock.claim()
    const owned = await lock.claim()

    expect(owned).toBe(true)
    expect(lock.ownedByMe.value).toBe(true)
  })

  it('release() clears ownedByMe and locked', async () => {
    const lock = useRealtimeLock('doc-4')
    await lock.claim()
    await lock.release()

    expect(lock.ownedByMe.value).toBe(false)
    expect(lock.locked.value).toBe(false)
  })

  it('reflects a lock already held by another client as locked but not owned', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('lock:claim', { key: 'doc-5' }, () => resolve()))

    const lock = useRealtimeLock('doc-5')
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(lock.locked.value).toBe(true)
    expect(lock.ownedByMe.value).toBe(false)

    other.close()
  })

  it('claim() fails when the lock is held by another client', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('lock:claim', { key: 'doc-6' }, () => resolve()))

    const lock = useRealtimeLock('doc-6')
    const owned = await lock.claim()

    expect(owned).toBe(false)
    expect(lock.locked.value).toBe(true)
    expect(lock.ownedByMe.value).toBe(false)

    other.close()
  })

  it('reacts to another client releasing the lock', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('lock:claim', { key: 'doc-7' }, () => resolve()))

    const lock = useRealtimeLock('doc-7')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(lock.locked.value).toBe(true)

    await new Promise<void>(resolve => other.emit('lock:release', { key: 'doc-7' }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(lock.locked.value).toBe(false)

    other.close()
  })

  it('best-effort releases an owned lock on unmount', async () => {
    const lock = useRealtimeLock('doc-8')
    await lock.claim()
    expect(lock.ownedByMe.value).toBe(true)

    triggerUnmount()
    await new Promise(resolve => setTimeout(resolve, 100))

    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    const owned = await new Promise<boolean>(resolve =>
      other.emit('lock:claim', { key: 'doc-8' }, (response: { owned: boolean }) => resolve(response.owned)),
    )

    expect(owned).toBe(true)
    other.close()
  })

  it('does not emit lock:release on unmount when the lock is not owned', async () => {
    const lock = useRealtimeLock('doc-9')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(lock.ownedByMe.value).toBe(false)

    const emitSpy = vi.spyOn(clientSocket, 'emit')
    triggerUnmount()

    expect(emitSpy).not.toHaveBeenCalledWith('lock:release', expect.objectContaining({ key: 'doc-9' }), expect.anything())
    emitSpy.mockRestore()
  })

  it('broadcasts ownerInfo passed to claim, and reflects it for other clients', async () => {
    const lock = useRealtimeLock('doc-10', { ownerInfo: 'Alice' })
    await lock.claim()
    expect(lock.ownerInfo.value).toBe('Alice')

    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    const state = await new Promise<{ owner: string | null, ownerInfo: unknown }>(resolve =>
      other.emit('lock:subscribe', 'doc-10', resolve),
    )

    expect(state.ownerInfo).toBe('Alice')
    other.close()
  })

  it('supports an arbitrary JSON-serializable ownerInfo shape via the generic', async () => {
    const lock = useRealtimeLock<{ name: string, avatarUrl: string }>('doc-11', {
      ownerInfo: { name: 'Alice', avatarUrl: '/alice.png' },
    })
    await lock.claim()

    expect(lock.ownerInfo.value).toEqual({ name: 'Alice', avatarUrl: '/alice.png' })
  })

  it('calls onReleased with changed:true when the release says the value changed', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('lock:claim', { key: 'doc-12' }, () => resolve()))

    const onReleased = vi.fn()
    useRealtimeLock('doc-12', { onReleased })
    await new Promise(resolve => setTimeout(resolve, 100))

    await new Promise<void>(resolve => other.emit('lock:release', { key: 'doc-12', changed: true }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(onReleased).toHaveBeenCalledWith({ changed: true })
    other.close()
  })

  it('calls onReleased with changed:false when the release does not follow a value change', async () => {
    const other = ioClient(`http://localhost:${serverPort}`)
    await new Promise<void>(resolve => other.on('connect', () => resolve()))
    await new Promise<void>(resolve => other.emit('lock:claim', { key: 'doc-13' }, () => resolve()))

    const onReleased = vi.fn()
    useRealtimeLock('doc-13', { onReleased })
    await new Promise(resolve => setTimeout(resolve, 100))

    await new Promise<void>(resolve => other.emit('lock:release', { key: 'doc-13' }, () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(onReleased).toHaveBeenCalledWith({ changed: false })
    other.close()
  })
})
