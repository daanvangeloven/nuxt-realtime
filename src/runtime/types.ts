import type { Socket } from 'socket.io-client'

// Socket acknowledgment response types
export interface StorageSetResponse {
  success: boolean
  status?: string
  error?: string
}

export interface EventPublishResponse {
  success: boolean
  error?: string
}

// Socket event payload types
export interface StorageUpdatePayload {
  key: string
  value: unknown
}

export interface EventReceivedPayload {
  channel: string
  data: unknown
}

export interface EventPublishPayload {
  channel: string
  data: unknown
  includeSelf: boolean
}

export interface LockClaimResponse {
  success: boolean
  owned: boolean
  error?: string
}

export interface LockReleaseResponse {
  success: boolean
  error?: string
}

export interface LockClaimPayload {
  key: string
  ownerInfo?: unknown
  /** Opaque group tag for bulk presence via lock:subscribeRoom. Not a route/URL concept. */
  room?: string
  /** Auto-release after this many ms of being held, regardless of activity. 0/undefined = no expiry. */
  ttl?: number
}

export interface LockReleasePayload {
  key: string
  /** Whether the release follows an actual value change, vs. e.g. abandoning an edit. */
  changed?: boolean
  /** Opaque app data (e.g. a diff) relayed verbatim in the lock:changed broadcast. */
  meta?: unknown
}

export interface LockChangedPayload {
  key: string
  /** Opaque connection identifier of the holder (or null if free), never a raw socket.id. */
  owner: string | null
  ownerInfo?: unknown
  changed?: boolean
  meta?: unknown
  room?: string
}

export type LockRoomSnapshot = Record<string, { owner: string, ownerInfo?: unknown }>

export interface LockForceReleaseResponse {
  success: boolean
  error?: string
}

export interface PresenceJoinPayload {
  room: string
  /** Opaque app data shown to other room members (e.g. `{ name, avatarUrl }`) */
  info?: unknown
}

export interface PresenceChangedPayload {
  room: string
  /** Opaque connection identifier of the member, never a raw socket.id. */
  connectionId: string
  /** null means this connectionId left the room. */
  info: unknown | null
}

export type PresenceSnapshot = Record<string, unknown>

export interface PresenceAckResponse {
  success: boolean
  error?: string
}

export interface RoomAckResponse {
  success: boolean
  error?: string
}

// Socket event maps
export interface ServerToClientEvents {
  'storage:updated': (data: StorageUpdatePayload) => void
  'event:received': (data: EventReceivedPayload) => void
  'lock:changed': (data: LockChangedPayload) => void
  'presence:changed': (data: PresenceChangedPayload) => void
}

export interface ClientToServerEvents {
  'storage:get': (key: string, callback: (value: unknown) => void) => void
  'storage:set': (data: { key: string, value: unknown }, callback: (response: StorageSetResponse) => void) => void
  'storage:subscribe': (key: string) => void
  'storage:unsubscribe': (key: string) => void
  'storage:heartbeat': () => void
  'event:subscribe': (channel: string) => void
  'event:unsubscribe': (channel: string) => void
  'event:publish': (data: EventPublishPayload, callback: (response: EventPublishResponse) => void) => void
  'lock:claim': (data: LockClaimPayload, callback: (response: LockClaimResponse) => void) => void
  'lock:release': (data: LockReleasePayload, callback: (response: LockReleaseResponse) => void) => void
  'lock:subscribe': (key: string, callback: (state: LockChangedPayload) => void) => void
  'lock:unsubscribe': (key: string) => void
  'lock:subscribeRoom': (room: string, callback: (snapshot: LockRoomSnapshot) => void) => void
  'lock:unsubscribeRoom': (room: string) => void
  'lock:forceRelease': (data: { key: string }, callback: (response: LockForceReleaseResponse) => void) => void
  'presence:join': (data: PresenceJoinPayload, callback: (response: PresenceAckResponse) => void) => void
  'presence:leave': (data: { room: string }, callback: (response: PresenceAckResponse) => void) => void
  'presence:subscribeRoom': (room: string, callback: (snapshot: PresenceSnapshot) => void) => void
  'room:join': (roomId: string, callback: (response: RoomAckResponse) => void) => void
  'room:leave': (roomId: string, callback: (response: RoomAckResponse) => void) => void
}

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>
