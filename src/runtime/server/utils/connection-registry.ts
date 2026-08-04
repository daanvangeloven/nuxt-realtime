import type { Storage } from 'unstorage'
import { claimOnce } from './lock'

export interface ConnectionRecord {
  socketId: string
  info: unknown
  /** Set when the connection has disconnected and is waiting to be reclaimed; null while active. */
  staleAt: number | null
}

export interface ConnectionRegistry {
  /** Registers a brand-new connectionId (no prior entry). */
  register: (connectionId: string, socketId: string, info?: unknown) => Promise<void>
  /** Remaps a stale entry to a new socketId and clears staleness. Returns false if no entry existed or the entry is still active (owned by a live connection). */
  reclaim: (connectionId: string, socketId: string) => Promise<boolean>
  lookup: (connectionId: string) => Promise<ConnectionRecord | null>
  /** Marks a connection as disconnected, starting its grace period. Storage write only, no timer. */
  markStale: (connectionId: string, socketId: string) => Promise<void>
  isGraceExpired: (record: ConnectionRecord, now?: number) => boolean
  remove: (connectionId: string) => Promise<void>
  /** All connectionIds currently in the registry (active or stale), for the grace-period sweep. */
  listIds: () => Promise<string[]>
}

const PREFIX = '_conn:'
const RECLAIM_PREFIX = '_reclaiming:'
const RECLAIM_MUTEX_TTL_MS = 5000

export function createConnectionRegistry(storage: Storage, options: { staleGraceMs: number }): ConnectionRegistry {
  const { staleGraceMs } = options

  return {
    async register(connectionId, socketId, info = null) {
      await storage.setItem<ConnectionRecord>(PREFIX + connectionId, { socketId, info, staleAt: null })
    },

    async reclaim(connectionId, socketId) {
      // Concurrent reconnects can both read the same stale record before either writes back,
      // so the read-check-write below is only safe done by one claimant at a time. `claimOnce`
      // (optimistic write-then-verify, race-free regardless of storage driver) guards it as a
      // mutex, same pattern room-registry.ts uses for its own claim/close critical sections.
      const mutexKey = RECLAIM_PREFIX + connectionId
      const wonMutex = await claimOnce(storage, mutexKey, socketId, RECLAIM_MUTEX_TTL_MS)
      if (!wonMutex) return false

      try {
        const existing = await storage.getItem<ConnectionRecord>(PREFIX + connectionId)
        // A connectionId is client-supplied, so a live (non-stale) record belongs to a socket
        // that's still connected: refuse to hand its identity to a different socket.
        if (!existing || existing.staleAt === null) return false
        await storage.setItem<ConnectionRecord>(PREFIX + connectionId, { ...existing, socketId, staleAt: null })
        return true
      }
      finally {
        await storage.removeItem(mutexKey)
      }
    },

    async lookup(connectionId) {
      return (await storage.getItem<ConnectionRecord>(PREFIX + connectionId)) ?? null
    },

    async markStale(connectionId, socketId) {
      const existing = await storage.getItem<ConnectionRecord>(PREFIX + connectionId)
      if (!existing || existing.socketId !== socketId) return
      await storage.setItem<ConnectionRecord>(PREFIX + connectionId, { ...existing, staleAt: Date.now() })
    },

    isGraceExpired(record, now = Date.now()) {
      return record.staleAt !== null && now - record.staleAt > staleGraceMs
    },

    async remove(connectionId) {
      await storage.removeItem(PREFIX + connectionId)
    },

    async listIds() {
      // Scoped to PREFIX so a CAS-capable driver (e.g. Redis) can SCAN just this namespace
      // instead of the whole keyspace on every sweep tick.
      const keys = await storage.getKeys(PREFIX)
      return keys.map(k => k.slice(PREFIX.length))
    },
  }
}
