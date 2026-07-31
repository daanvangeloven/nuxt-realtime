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
}

export interface LockReleasePayload {
  key: string
  /** Whether the release follows an actual value change, vs. e.g. abandoning an edit. */
  changed?: boolean
}

export interface LockChangedPayload {
  key: string
  owner: string | null
  ownerInfo?: unknown
  changed?: boolean
}

// Socket event maps
export interface ServerToClientEvents {
  'storage:updated': (data: StorageUpdatePayload) => void
  'event:received': (data: EventReceivedPayload) => void
  'lock:changed': (data: LockChangedPayload) => void
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
}

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>
