import type { Driver, Storage } from 'unstorage'

/**
 * Drivers may implement these for real cross-process atomic compare-and-set.
 * Without them, claimLock()/releaseLock() fall back to a naive getItem/setItem sequence.
 */
export interface LockCapableDriver extends Driver {
  claimLock?: (key: string, owner: string, ttlMs?: number) => Promise<boolean>
  releaseLock?: (key: string, owner: string) => Promise<boolean>
}

export interface ClaimLockOptions {
  /** Opaque group tag for bulk presence via lock:subscribeRoom. Only touched when explicitly set. */
  room?: string
  /** Auto-expire this many ms after claiming, regardless of activity. 0/undefined = no expiry. */
  ttl?: number
}

interface FallbackLockRecord {
  owner: string
  expiresAt?: number
}

// Matches the mount base used by useStorage('nuxt-realtime')
const STORAGE_PREFIX = 'nuxt-realtime:'

function resolveLockDriver(storage: Storage, lockKey: string): { driver: LockCapableDriver, relativeKey: string } {
  const fullKey = STORAGE_PREFIX + lockKey
  const { driver, base } = storage.getMount(fullKey)
  return { driver: driver as LockCapableDriver, relativeKey: fullKey.slice(base.length) }
}

export async function touchLease(storage: Storage, key: string): Promise<void> {
  await storage.setItem(`_lease:${key}`, { lastSeen: Date.now() })
}

function isExpired(record: FallbackLockRecord | null | undefined): boolean {
  return !!record && record.expiresAt !== undefined && Date.now() > record.expiresAt
}

// naive getItem -> setItem fallback in case claimLock and releaseLock aren't implemented by the chosen driver.
// Lazily treats an expired record as free rather than requiring an active sweep.
async function claimLockFallback(storage: Storage, lockKey: string, owner: string, ttl?: number): Promise<boolean> {
  const current = await storage.getItem<FallbackLockRecord>(lockKey)
  if (current && current.owner !== owner && !isExpired(current)) {
    return false
  }
  const expiresAt = ttl ? Date.now() + ttl : undefined
  await storage.setItem(lockKey, expiresAt !== undefined ? { owner, expiresAt } : { owner })
  return true
}

async function releaseLockFallback(storage: Storage, lockKey: string, owner: string): Promise<boolean> {
  const current = await storage.getItem<FallbackLockRecord>(lockKey)
  if (!current || current.owner !== owner) {
    return false
  }
  await storage.removeItem(lockKey)
  return true
}

// Room membership is stored one key per member (`_roomkeys:{room}:{key}`) rather than a
// shared array, so two concurrent claims into the same room never race on a read-modify-write
// of the same storage value: each claim only ever touches its own membership key.
async function untagRoom(storage: Storage, key: string): Promise<void> {
  const room = await storage.getItem<string>(`_lockroom:${key}`)
  if (!room) return
  await storage.removeItem(`_roomkeys:${room}:${key}`)
  await storage.removeItem(`_lockroom:${key}`)
}

async function tagRoom(storage: Storage, key: string, room: string): Promise<void> {
  const previousRoom = await storage.getItem<string>(`_lockroom:${key}`)
  if (previousRoom && previousRoom !== room) {
    await untagRoom(storage, key)
  }
  await storage.setItem(`_roomkeys:${room}:${key}`, true)
  await storage.setItem(`_lockroom:${key}`, room)
}

// Same one-key-per-owner reverse index as tagRoom/untagRoom above, so getLocksOwnedBy() can
// look up a owner's locks by prefix instead of scanning every key in storage.
async function untagOwner(storage: Storage, key: string): Promise<void> {
  const owner = await storage.getItem<string>(`_lockowner:${key}`)
  if (!owner) return
  await storage.removeItem(`_ownerlocks:${owner}:${key}`)
  await storage.removeItem(`_lockowner:${key}`)
}

async function tagOwner(storage: Storage, key: string, owner: string): Promise<void> {
  const previousOwner = await storage.getItem<string>(`_lockowner:${key}`)
  if (previousOwner && previousOwner !== owner) {
    await untagOwner(storage, key)
  }
  await storage.setItem(`_ownerlocks:${owner}:${key}`, true)
  await storage.setItem(`_lockowner:${key}`, owner)
}

/**
 * Atomic (on a CAS-capable driver, e.g. Redis) compare-and-set claim of `key` by `claimant`,
 * the pure primitive `claimLock` builds on. Exposed so other features that need a real "only
 * one caller wins" claim (e.g. room-registry.ts's room-creation detection) can reuse the same
 * driver-capability-detection instead of re-deriving their own, non-atomic version of it.
 *
 * On a driver without native CAS, this is a best-effort getItem->setItem sequence, same
 * documented tradeoff as `claimLock` itself on the fallback path (see `claimLockFallback`).
 */
export async function claimOnce(storage: Storage, key: string, claimant: string, ttlMs?: number): Promise<boolean> {
  const { driver, relativeKey } = resolveLockDriver(storage, key)
  return driver.claimLock
    ? driver.claimLock(relativeKey, claimant, ttlMs)
    : claimLockFallback(storage, key, claimant, ttlMs)
}

/**
 * Claims a lock for `key`. Succeeds if the lock is currently free, already owned by `owner`,
 * or its TTL has lapsed. `ownerInfo` is stored alongside the lock purely for display (see
 * getLockOwnerInfo) and plays no part in the claim/release check; it's opaque to this module.
 *
 * `opts.room`, if given, tags the lock for bulk snapshot/live-diff via lock:subscribeRoom.
 * `opts.ttl` (ms) auto-expires the lock; omitted/0 means it's held until explicitly released.
 */
export async function claimLock(storage: Storage, key: string, owner: string, ownerInfo?: unknown, opts: ClaimLockOptions = {}): Promise<boolean> {
  const lockKey = `_lock:${key}`
  const claimed = await claimOnce(storage, lockKey, owner, opts.ttl)

  if (claimed) {
    await touchLease(storage, lockKey)
    await storage.setItem(`_lockinfo:${key}`, ownerInfo ?? null)
    await tagOwner(storage, key, owner)
    if (opts.room) {
      await tagRoom(storage, key, opts.room)
    }
  }
  return claimed
}

/**
 * Releases a lock for `key`. Only clears it if `owner` is the current holder.
 */
export async function releaseLock(storage: Storage, key: string, owner: string): Promise<boolean> {
  const lockKey = `_lock:${key}`
  const { driver, relativeKey } = resolveLockDriver(storage, lockKey)

  const released = driver.releaseLock
    ? await driver.releaseLock(relativeKey, owner)
    : await releaseLockFallback(storage, lockKey, owner)

  // Also clean up bookkeeping when the lock already expired on its own (native TTL or lazy
  // fallback expiry) rather than being explicitly released: otherwise the owner index and
  // stale info/room tags from that claim would never get cleared.
  const indexedOwner = await storage.getItem<string>(`_lockowner:${key}`)
  if (released || indexedOwner === owner) {
    await storage.removeItem(`_lockinfo:${key}`)
    await untagRoom(storage, key)
    await untagOwner(storage, key)
  }
  return released
}

/**
 * Reads the current owner of a lock without claiming it, or `null` if it's free
 * (including a lock whose TTL has lapsed on the fallback/naive driver path).
 */
export async function getLockOwner(storage: Storage, key: string): Promise<string | null> {
  const lockKey = `_lock:${key}`
  const { driver } = resolveLockDriver(storage, lockKey)

  // Driver-capable locks store the raw owner string (see reactiveRedisDriver); Redis enforces
  // its own TTL natively, so an expired lock is simply already gone by the time we read it.
  if (driver.claimLock) {
    return (await storage.getItem<string>(lockKey)) ?? null
  }
  // Fallback path stores `{ owner, expiresAt? }` (see claimLockFallback above).
  const current = await storage.getItem<FallbackLockRecord>(lockKey)
  if (isExpired(current)) return null
  return current?.owner ?? null
}

/**
 * Reads the opaque info stored alongside a lock's owner, or `null` if unset/free.
 */
export async function getLockOwnerInfo(storage: Storage, key: string): Promise<unknown> {
  return (await storage.getItem(`_lockinfo:${key}`)) ?? null
}

/**
 * Reads the room a lock is currently tagged with, or `null` if it has none.
 */
export async function getLockRoom(storage: Storage, key: string): Promise<string | null> {
  return (await storage.getItem<string>(`_lockroom:${key}`)) ?? null
}

/**
 * Returns the keys of every lock currently tagged with `room`.
 */
export async function getRoomKeys(storage: Storage, room: string): Promise<string[]> {
  const prefix = `_roomkeys:${room}:`
  const allKeys = await storage.getKeys(prefix)
  return allKeys.map(k => k.slice(prefix.length))
}

/**
 * Returns the keys of every lock currently held by `owner`, used to release everything a
 * connection was holding once its grace period lapses (see connection-registry.ts) or on
 * an immediate disconnect when no connectionId was supplied.
 */
export async function getLocksOwnedBy(storage: Storage, owner: string): Promise<string[]> {
  const prefix = `_ownerlocks:${owner}:`
  const keys = await storage.getKeys(prefix)
  return keys.map(k => k.slice(prefix.length))
}
