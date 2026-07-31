import type { DevtoolsEventLogEntry } from '../types'

export interface AppendEventsOptions {
  existing: DevtoolsEventLogEntry[]
  incoming: DevtoolsEventLogEntry[]
  lastId: number
  maxEntries: number
}

export interface AppendEventsResult {
  events: DevtoolsEventLogEntry[]
  lastId: number
}

/** Prepends newly-polled events (newest first) and caps the log at `maxEntries`. */
export function appendEvents({ existing, incoming, lastId, maxEntries }: AppendEventsOptions): AppendEventsResult {
  return {
    events: [...incoming, ...existing].slice(0, maxEntries),
    lastId: incoming.reduce((max, e) => Math.max(max, e.id), lastId),
  }
}
