import { describe, it, expect } from 'vitest'
import {
  getConnectionSummaries,
  getStorageSnapshot,
  getLockSnapshot,
  getPresenceOverview,
  getRoomMembershipSnapshot,
  createEventLog,
  safeSerialize,
  type DevtoolsIoLike,
  type DevtoolsSocketLike,
  type DevtoolsStorageLike,
} from './devtools-state'

function fakeStorage(data: Record<string, unknown>): DevtoolsStorageLike {
  return {
    getKeys: async (prefix = '') => Object.keys(data).filter(key => key.startsWith(prefix)),
    getItem: async (key: string) => data[key] ?? null,
  }
}

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

  it('splits rooms into channels, storage keys, presence rooms, lock keys, and rooms, excluding the socket\'s own id room', () => {
    const socket = fakeSocket({
      id: 'socket-1',
      rooms: ['socket-1', 'event:chat', 'event:notifications:*', 'key:counter', 'presence:doc-1', 'lock:doc-1', 'room:doc-1'],
    })

    const [summary] = getConnectionSummaries(fakeIo([socket]))

    expect(summary).toEqual({
      id: 'socket-1',
      address: '127.0.0.1',
      transport: 'websocket',
      connectedAt: 1000,
      channels: ['chat', 'notifications:*'],
      storageKeys: ['counter'],
      presenceRooms: ['doc-1'],
      lockKeys: ['doc-1'],
      rooms: ['doc-1'],
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

describe('getLockSnapshot', () => {
  it('returns an empty list when no lock is held', async () => {
    expect(await getLockSnapshot(fakeStorage({}))).toEqual([])
  })

  it('assembles owner, info, and room from the separate lock keys', async () => {
    const expiresAt = Date.now() + 60_000
    const storage = fakeStorage({
      '_lock:doc-1': { owner: 'alice', expiresAt },
      '_lockinfo:doc-1': { name: 'Alice' },
      '_lockroom:doc-1': 'project-42',
    })

    expect(await getLockSnapshot(storage)).toEqual([
      { key: 'doc-1', owner: 'alice', ownerInfo: { name: 'Alice' }, room: 'project-42', expiresAt },
    ])
  })

  it('reports room as null and expiresAt as undefined when neither was set', async () => {
    const storage = fakeStorage({ '_lock:doc-1': { owner: 'alice' } })

    expect(await getLockSnapshot(storage)).toEqual([
      { key: 'doc-1', owner: 'alice', ownerInfo: null, room: null, expiresAt: undefined },
    ])
  })

  it('skips a lock whose ttl has lazily lapsed', async () => {
    const storage = fakeStorage({ '_lock:doc-1': { owner: 'alice', expiresAt: Date.now() - 1000 } })

    expect(await getLockSnapshot(storage)).toEqual([])
  })
})

describe('getPresenceOverview', () => {
  it('returns an empty list for a connectionId with no presence', async () => {
    expect(await getPresenceOverview(fakeStorage({}), ['conn-1'])).toEqual([])
  })

  it('resolves room and info via the reverse index, without parsing the combined key', async () => {
    const storage = fakeStorage({
      '_connrooms:conn-1:document:123': true,
      '_presence:document:123:conn-1': { name: 'Alice' },
    })

    expect(await getPresenceOverview(storage, ['conn-1'])).toEqual([
      { room: 'document:123', connectionId: 'conn-1', info: { name: 'Alice' } },
    ])
  })

  it('collects entries across multiple connectionIds', async () => {
    const storage = fakeStorage({
      '_connrooms:conn-1:room-a': true,
      '_presence:room-a:conn-1': 'Alice',
      '_connrooms:conn-2:room-b': true,
      '_presence:room-b:conn-2': 'Bob',
    })

    const entries = await getPresenceOverview(storage, ['conn-1', 'conn-2'])
    expect(entries).toEqual([
      { room: 'room-a', connectionId: 'conn-1', info: 'Alice' },
      { room: 'room-b', connectionId: 'conn-2', info: 'Bob' },
    ])
  })
})

describe('getRoomMembershipSnapshot', () => {
  it('returns an empty list for a connectionId in no rooms', async () => {
    expect(await getRoomMembershipSnapshot(fakeStorage({}), ['conn-1'])).toEqual([])
  })

  it('resolves roomId via the reverse index, without parsing the combined key', async () => {
    const storage = fakeStorage({ '_memberrooms:conn-1:document:123': true })

    expect(await getRoomMembershipSnapshot(storage, ['conn-1'])).toEqual([
      { roomId: 'document:123', connectionId: 'conn-1' },
    ])
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
