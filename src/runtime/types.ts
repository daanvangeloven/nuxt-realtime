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

// Socket event maps
export interface ServerToClientEvents {
  'storage:updated': (data: StorageUpdatePayload) => void
  'event:received': (data: EventReceivedPayload) => void
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
}

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>
