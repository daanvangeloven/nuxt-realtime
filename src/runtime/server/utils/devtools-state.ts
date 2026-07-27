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
}

export interface StorageSnapshotEntry {
  key: string
  value: unknown
  subscriberCount: number
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
  getKeys: () => Promise<string[]>
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
 * Summarizes every currently connected socket: which event channels and
 * storage keys it's subscribed to (derived from its room memberships), split
 * on the `event:`/`key:` room-name prefixes used elsewhere in the plugin.
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

    summaries.push({
      id,
      address: socket.handshake.address,
      transport: socket.conn.transport.name,
      connectedAt: socket.handshake.issued,
      channels,
      storageKeys,
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
