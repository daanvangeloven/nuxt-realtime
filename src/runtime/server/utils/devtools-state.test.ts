import { describe, it, expect } from 'vitest'
import {
  getConnectionSummaries,
  getStorageSnapshot,
  createEventLog,
  safeSerialize,
  type DevtoolsIoLike,
  type DevtoolsSocketLike,
} from './devtools-state'

function fakeSocket(overrides: Partial<DevtoolsSocketLike> & { id: string }): DevtoolsSocketLike {
  return {
    handshake: { address: '127.0.0.1', issued: 1000 },
    conn: { transport: { name: 'websocket' } },
    rooms: [overrides.id],
    ...overrides,
  }
}

function fakeIo(sockets: DevtoolsSocketLike[], rooms: Map<string, Set<string>> = new Map()): DevtoolsIoLike {
  return {
    sockets: {
      sockets: new Map(sockets.map(s => [s.id, s])),
      adapter: { rooms },
    },
  }
}

describe('getConnectionSummaries', () => {
  it('returns an empty list when there are no sockets', () => {
    expect(getConnectionSummaries(fakeIo([]))).toEqual([])
  })

  it('splits rooms into channels and storage keys, excluding the socket\'s own id room', () => {
    const socket = fakeSocket({
      id: 'socket-1',
      rooms: ['socket-1', 'event:chat', 'event:notifications:*', 'key:counter'],
    })

    const [summary] = getConnectionSummaries(fakeIo([socket]))

    expect(summary).toEqual({
      id: 'socket-1',
      address: '127.0.0.1',
      transport: 'websocket',
      connectedAt: 1000,
      channels: ['chat', 'notifications:*'],
      storageKeys: ['counter'],
    })
  })

  it('summarizes multiple sockets independently', () => {
    const socketA = fakeSocket({ id: 'a', rooms: ['a', 'event:x'] })
    const socketB = fakeSocket({ id: 'b', rooms: ['b', 'key:y'] })

    const summaries = getConnectionSummaries(fakeIo([socketA, socketB]))

    expect(summaries).toHaveLength(2)
    expect(summaries.find(s => s.id === 'a')?.channels).toEqual(['x'])
    expect(summaries.find(s => s.id === 'b')?.storageKeys).toEqual(['y'])
  })
})

describe('getStorageSnapshot', () => {
  it('filters out _lease: shadow keys', async () => {
    const storage = {
      getKeys: async () => ['counter', '_lease:counter'],
      getItem: async (key: string) => (key === 'counter' ? 42 : { lastSeen: 123 }),
    }

    const snapshot = await getStorageSnapshot(storage, fakeIo([]))

    expect(snapshot).toEqual([{ key: 'counter', value: 42, subscriberCount: 0 }])
  })

  it('reads the subscriber count from the matching key: room size', async () => {
    const storage = {
      getKeys: async () => ['counter'],
      getItem: async () => 42,
    }
    const rooms = new Map([['key:counter', new Set(['socket-1', 'socket-2'])]])

    const [entry] = await getStorageSnapshot(storage, fakeIo([], rooms))

    expect(entry!.subscriberCount).toBe(2)
  })

  it('defaults subscriber count to 0 when no room exists for the key', async () => {
    const storage = {
      getKeys: async () => ['orphan'],
      getItem: async () => 'value',
    }

    const [entry] = await getStorageSnapshot(storage, fakeIo([]))

    expect(entry!.subscriberCount).toBe(0)
  })
})

describe('safeSerialize', () => {
  it('returns small values unchanged', () => {
    expect(safeSerialize({ a: 1 })).toEqual({ a: 1 })
    expect(safeSerialize('short')).toBe('short')
    expect(safeSerialize(null)).toBe(null)
  })

  it('truncates values whose JSON representation exceeds maxLen', () => {
    const big = 'x'.repeat(100)
    const result = safeSerialize(big, 10)

    expect(typeof result).toBe('string')
    expect((result as string).length).toBeLessThan(big.length + 20)
    expect(result).toContain('truncated')
  })

  it('falls back to a placeholder for unserializable (circular) values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(safeSerialize(circular)).toBe('[unserializable value]')
  })
})

describe('createEventLog', () => {
  it('assigns monotonically increasing ids', () => {
    const log = createEventLog(10)

    log.record('connect', 'socket-1')
    log.record('connect', 'socket-2')
    log.record('disconnect', 'socket-1')

    const entries = log.list()
    expect(entries.map(e => e.id)).toEqual([1, 2, 3])
  })

  it('filters entries by sinceId', () => {
    const log = createEventLog(10)

    log.record('connect', 'socket-1')
    log.record('connect', 'socket-2')
    log.record('connect', 'socket-3')

    expect(log.list(1).map(e => e.socketId)).toEqual(['socket-2', 'socket-3'])
    expect(log.list(3)).toEqual([])
  })

  it('evicts the oldest entry once capacity is exceeded', () => {
    const log = createEventLog(2)

    log.record('connect', 'socket-1')
    log.record('connect', 'socket-2')
    log.record('connect', 'socket-3')

    const entries = log.list()
    expect(entries).toHaveLength(2)
    expect(entries.map(e => e.socketId)).toEqual(['socket-2', 'socket-3'])
  })

  it('stores the optional detail string and a timestamp', () => {
    const log = createEventLog(10)

    log.record('storage:set', 'socket-1', 'counter')

    const [entry] = log.list()
    expect(entry!.detail).toBe('counter')
    expect(entry!.timestamp).toBeCloseTo(Date.now(), -2)
  })
})
