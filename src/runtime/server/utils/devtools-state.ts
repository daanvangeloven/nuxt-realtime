// side-effect-free state helpers for the Nuxt Realtime devtools tab

/**
 * Deliberately excludes noisy, non-state-changing events (`storage:get`, `storage:heartbeat`).
 */
export type DevtoolsEventType
  = | 'connect'
    | 'disconnect'
    | 'event:subscribe'
    | 'event:unsubscribe'
    | 'event:publish'
    | 'storage:subscribe'
    | 'storage:unsubscribe'
    | 'storage:set'
    | 'lock:claim'
    | 'lock:release'
    | 'lock:forceRelease'
    | 'presence:join'
    | 'presence:leave'
    | 'room:join'
    | 'room:leave'

export interface DevtoolsEventLogEntry {
  id: number
  type: DevtoolsEventType
  socketId: string
  detail?: string
  timestamp: number
}

export interface ConnectionSummary {
  id: string
  address: string
  transport: string
  connectedAt: number
  channels: string[]
  storageKeys: string[]
  presenceRooms: string[]
  lockKeys: string[]
  rooms: string[]
}

export interface StorageSnapshotEntry {
  key: string
  value: unknown
  subscriberCount: number
}

export interface LockSnapshotEntry {
  key: string
  owner: string
  ownerInfo: unknown
  room: string | null
  expiresAt?: number
}

export interface PresenceSnapshotEntry {
  room: string
  connectionId: string
  info: unknown
}

export interface RoomMembershipEntry {
  roomId: string
  connectionId: string
}

// Minimal structural shapes for the bits of socket.io's `io` object this
// module reads. Kept local (rather than importing from `socket.io`) so this
// file has no runtime dependency on it and tests can pass in plain mocks.
export interface DevtoolsSocketLike {
  id: string
  rooms: Iterable<string>
  handshake: { address: string, issued: number }
  conn: { transport: { name: string } }
}

export interface DevtoolsIoLike {
  sockets: {
    sockets: Map<string, DevtoolsSocketLike>
    adapter: { rooms: Map<string, Set<string>> }
  }
}

export interface DevtoolsStorageLike {
  getKeys: (prefix?: string) => Promise<string[]>
  getItem: (key: string) => Promise<unknown>
}

const DEFAULT_MAX_VALUE_LEN = 2000

/**
 * Guards a storage value against wedging the devtools HTTP hop: circular
 * references or oversized payloads are replaced with a truncated/placeholder
 * string instead of being returned as-is.
 */
export function safeSerialize(value: unknown, maxLen = DEFAULT_MAX_VALUE_LEN): unknown {
  let json: string
  try {
    json = JSON.stringify(value) ?? String(value)
  }
  catch {
    return '[unserializable value]'
  }

  return json.length > maxLen
    ? `${json.slice(0, maxLen)}… (truncated, ${json.length} chars)`
    : value
}

/**
 * Summarizes every currently connected socket: which event channels, storage
 * keys, presence rooms, lock keys, and rooms it's subscribed to (derived from
 * its room memberships), split on the respective room-name prefixes used
 * elsewhere in the plugin.
 */
export function getConnectionSummaries(io: DevtoolsIoLike): ConnectionSummary[] {
  const summaries: ConnectionSummary[] = []

  for (const [id, socket] of io.sockets.sockets) {
    const rooms = [...socket.rooms].filter(room => room !== id)
    const channels = rooms
      .filter(room => room.startsWith('event:'))
      .map(room => room.slice('event:'.length))
    const storageKeys = rooms
      .filter(room => room.startsWith('key:'))
      .map(room => room.slice('key:'.length))
    const presenceRooms = rooms
      .filter(room => room.startsWith('presence:'))
      .map(room => room.slice('presence:'.length))
    const lockKeys = rooms
      .filter(room => room.startsWith('lock:'))
      .map(room => room.slice('lock:'.length))
    const memberRooms = rooms
      .filter(room => room.startsWith('room:'))
      .map(room => room.slice('room:'.length))

    summaries.push({
      id,
      address: socket.handshake.address,
      transport: socket.conn.transport.name,
      connectedAt: socket.handshake.issued,
      channels,
      storageKeys,
      presenceRooms,
      lockKeys,
      rooms: memberRooms,
    })
  }

  return summaries
}

/**
 * Snapshots all storage keys/values, filtering out internal `_lease:` shadow
 * keys and attaching a live subscriber count from the matching `key:` room.
 */
export async function getStorageSnapshot(storage: DevtoolsStorageLike, io: DevtoolsIoLike): Promise<StorageSnapshotEntry[]> {
  const keys = (await storage.getKeys()).filter(key => !key.startsWith('_lease:'))

  return Promise.all(keys.map(async (key) => {
    const value = await storage.getItem(key)
    const subscriberCount = io.sockets.adapter.rooms.get(`key:${key}`)?.size ?? 0

    return {
      key,
      value: safeSerialize(value),
      subscriberCount,
    }
  }))
}

/**
 * Snapshots every currently-held lock (owner, opaque owner info, room tag if
 * any, expiry). Reads `_lock:`/`_lockinfo:`/`_lockroom:` keys directly rather
 * than importing from `lock.ts`, matching this file's existing no-sibling-
 * import convention (see `_lease:` handling in `getStorageSnapshot` above).
 * Skips a key whose TTL has lazily lapsed, mirroring `lock.ts`'s own
 * `isExpired` check, so an expired-but-not-yet-cleaned-up lock doesn't show
 * as still held.
 */
export async function getLockSnapshot(storage: DevtoolsStorageLike): Promise<LockSnapshotEntry[]> {
  const prefix = '_lock:'
  const keys = await storage.getKeys(prefix)

  const entries = await Promise.all(keys.map(async (fullKey): Promise<LockSnapshotEntry | null> => {
    const key = fullKey.slice(prefix.length)
    const record = await storage.getItem(fullKey) as { owner: string, expiresAt?: number } | null
    if (!record || (record.expiresAt !== undefined && Date.now() > record.expiresAt)) {
      return null
    }
    const [ownerInfo, room] = await Promise.all([
      storage.getItem(`_lockinfo:${key}`),
      storage.getItem(`_lockroom:${key}`) as Promise<string | null>,
    ])

    return {
      key,
      owner: record.owner,
      ownerInfo: safeSerialize(ownerInfo),
      room: room ?? null,
      expiresAt: record.expiresAt,
    }
  }))

  return entries.filter((entry): entry is LockSnapshotEntry => entry !== null)
}

/**
 * Snapshots presence membership for every given `connectionId` (typically
 * every id `ConnectionRegistry.listIds()` returns). Presence keys are
 * `_presence:<room>:<connectionId>`, and room names may themselves contain
 * colons, so splitting a scanned key apart to recover room/connectionId is
 * ambiguous. Scanning the other direction avoids that entirely: each
 * connectionId's own reverse-index prefix (`_connrooms:<connectionId>:`)
 * leaves only the room unknown.
 */
export async function getPresenceOverview(storage: DevtoolsStorageLike, connectionIds: string[]): Promise<PresenceSnapshotEntry[]> {
  const entries: PresenceSnapshotEntry[] = []

  for (const connectionId of connectionIds) {
    const prefix = `_connrooms:${connectionId}:`
    const roomKeys = await storage.getKeys(prefix)
    for (const roomKey of roomKeys) {
      const room = roomKey.slice(prefix.length)
      const info = await storage.getItem(`_presence:${room}:${connectionId}`)
      entries.push({ room, connectionId, info: safeSerialize(info) })
    }
  }

  return entries
}

/**
 * Snapshots `useRealtimeRoom` membership for every given `connectionId`.
 * Same reverse-index approach as `getPresenceOverview` and for the same
 * reason: `_memberrooms:<connectionId>:` leaves only the roomId unknown.
 */
export async function getRoomMembershipSnapshot(storage: DevtoolsStorageLike, connectionIds: string[]): Promise<RoomMembershipEntry[]> {
  const entries: RoomMembershipEntry[] = []

  for (const connectionId of connectionIds) {
    const prefix = `_memberrooms:${connectionId}:`
    const roomKeys = await storage.getKeys(prefix)
    for (const roomKey of roomKeys) {
      entries.push({ roomId: roomKey.slice(prefix.length), connectionId })
    }
  }

  return entries
}

/**
 * In-memory ring buffer of recent devtools events, capped at `size` entries
 * (oldest evicted first). Not persisted across restarts
 */
export function createEventLog(size: number) {
  const buffer: DevtoolsEventLogEntry[] = []
  let nextId = 1

  function record(type: DevtoolsEventType, socketId: string, detail?: string): void {
    buffer.push({ id: nextId++, type, socketId, detail, timestamp: Date.now() })
    if (buffer.length > size) {
      buffer.shift()
    }
  }

  function list(sinceId = 0): DevtoolsEventLogEntry[] {
    return buffer.filter(entry => entry.id > sinceId)
  }

  return { record, list }
}

export type EventLog = ReturnType<typeof createEventLog>

const DEFAULT_EVENT_LOG_SIZE = 200

/**
 * Server-bundle-local devtools state. `io` is set by the socketio Nitro
 * plugin once the server instance exists (only when devtools is enabled);
 * `eventLog` can be re-created with a configured size at plugin startup.
 */
export const devtoolsState: { io: DevtoolsIoLike | null, eventLog: EventLog } = {
  io: null,
  eventLog: createEventLog(DEFAULT_EVENT_LOG_SIZE),
}
