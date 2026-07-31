import type { Driver, Storage } from 'unstorage'

/**
 * Drivers may implement these for real cross-process atomic compare-and-set.
 * Without them, claimLock()/releaseLock() fall back to a naive getItem/setItem suquence.
 */
export interface LockCapableDriver extends Driver {
  claimLock?: (key: string, owner: string) => Promise<boolean>
  releaseLock?: (key: string, owner: string) => Promise<boolean>
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

// naive getItem -> setItem fallback in case claimLock and releaseLock aren't implemented by the chosen driver
async function claimLockFallback(storage: Storage, lockKey: string, owner: string): Promise<boolean> {
  const current = await storage.getItem<{ owner: string }>(lockKey)
  if (current && current.owner !== owner) {
    return false
  }
  await storage.setItem(lockKey, { owner })
  return true
}

async function releaseLockFallback(storage: Storage, lockKey: string, owner: string): Promise<boolean> {
  const current = await storage.getItem<{ owner: string }>(lockKey)
  if (!current || current.owner !== owner) {
    return false
  }
  await storage.removeItem(lockKey)
  return true
}

/**
 * Claims a lock for `key`. Succeeds if the lock is currently free or already owned by `owner`.
 * `ownerInfo` is stored alongside the lock purely for display (see getLockOwnerInfo) and
 * plays no part in the claim/release check — it's opaque to this module.
 */
export async function claimLock(storage: Storage, key: string, owner: string, ownerInfo?: unknown): Promise<boolean> {
  const lockKey = `_lock:${key}`
  const { driver, relativeKey } = resolveLockDriver(storage, lockKey)

  const claimed = driver.claimLock
    ? await driver.claimLock(relativeKey, owner)
    : await claimLockFallback(storage, lockKey, owner)

  if (claimed) {
    await touchLease(storage, lockKey)
    await storage.setItem(`_lockinfo:${key}`, ownerInfo ?? null)
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

  if (released) {
    await storage.removeItem(`_lockinfo:${key}`)
  }
  return released
}

/**
 * Reads the current owner of a lock without claiming it, or `null` if it's free.
 */
export async function getLockOwner(storage: Storage, key: string): Promise<string | null> {
  const lockKey = `_lock:${key}`
  const { driver } = resolveLockDriver(storage, lockKey)

  // Driver-capable locks store the raw owner string (see reactiveRedisDriver); the fallback
  // path stores `{ owner }` (see claimLockFallback above).
  if (driver.claimLock) {
    return (await storage.getItem<string>(lockKey)) ?? null
  }
  const current = await storage.getItem<{ owner: string }>(lockKey)
  return current?.owner ?? null
}

/**
 * Reads the opaque info stored alongside a lock's owner, or `null` if unset/free.
 */
export async function getLockOwnerInfo(storage: Storage, key: string): Promise<unknown> {
  return (await storage.getItem(`_lockinfo:${key}`)) ?? null
}
