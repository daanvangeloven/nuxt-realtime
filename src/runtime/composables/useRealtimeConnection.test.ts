import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { useRealtimeConnection } from './useRealtimeConnection'

vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $realtimeSocket: fakeSocket,
    $realtimeConnectionId: connectionIdRef,
  }),
}))

let fakeSocket: unknown
let connectionIdRef: { value: string | undefined }

function createFakeSocket() {
  const emitter = new EventEmitter()
  const manager = new EventEmitter()
  return Object.assign(emitter, {
    connected: false,
    active: true,
    io: manager,
    connect: vi.fn(),
    disconnect: vi.fn(),
  })
}

describe('useRealtimeConnection', () => {
  it('exposes the connectionId provided by the plugin', () => {
    fakeSocket = createFakeSocket()
    connectionIdRef = { value: 'conn-123' }

    const { connectionId } = useRealtimeConnection()

    expect(connectionId.value).toBe('conn-123')
  })

  it('is undefined when the plugin has not resolved a connectionId yet', () => {
    fakeSocket = createFakeSocket()
    connectionIdRef = { value: undefined }

    const { connectionId } = useRealtimeConnection()

    expect(connectionId.value).toBeUndefined()
  })
})
