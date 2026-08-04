/**
 * Minimal cross-instance pub/sub contract. Storage-watch relay and cross-server event relay
 * are built on top of this alone, so any transport (Redis pub/sub today, others later) is a
 * drop-in as long as it implements these four members.
 */
export interface PubSubDriver {
  instanceId: string
  publish: (channel: string, data: unknown) => Promise<void>
  subscribe: (channel: string, handler: (message: string) => void) => () => void
  dispose: () => Promise<void>
}
