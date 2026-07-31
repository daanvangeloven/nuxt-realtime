// Mirrors src/runtime/server/utils/devtools-state.ts. Duplicated (rather than
// imported) so this client stays a fully standalone package with its own
// build/tsconfig, decoupled from the module's server bundle.

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

export interface DevtoolsEventLogEntry {
  id: number
  type: string
  socketId: string
  detail?: string
  timestamp: number
}

export interface RealtimeRpc {
  getConnections: () => Promise<ConnectionSummary[]>
  getStorageSnapshot: () => Promise<StorageSnapshotEntry[]>
  getEventLog: (sinceId?: number) => Promise<DevtoolsEventLogEntry[]>
}

export const EVENT_TYPES = [
  'connect',
  'disconnect',
  'event:subscribe',
  'event:unsubscribe',
  'event:publish',
  'storage:subscribe',
  'storage:unsubscribe',
  'storage:set',
] as const

export type EventType = (typeof EVENT_TYPES)[number]
