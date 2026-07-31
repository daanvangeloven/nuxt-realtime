import { describe, it, expect, beforeEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { claimLock, releaseLock, getLockOwner, getLockOwnerInfo } from './lock'

// Mirrors how the plugin obtains its storage: a root storage with a dedicated
// "nuxt-realtime" mount, accessed through a prefixed view (see useStorage('nuxt-realtime')
// in socketio.ts). This exercises the real getMount()/prefix-stripping path rather than a mock.
function createTestStorage(): Storage {
  const root = createStorage({ driver: memoryDriver() })
  root.mount('nuxt-realtime', memoryDriver())
  return prefixStorage(root, 'nuxt-realtime')
}

describe('lock - generic fallback (memory driver, no claimLock/releaseLock support)', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createTestStorage()
  })

  it('claim succeeds when the lock is free', async () => {
    await expect(claimLock(storage, 'doc-1', 'alice')).resolves.toBe(true)
  })

  it('claim by the same owner is idempotent', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    await expect(claimLock(storage, 'doc-1', 'alice')).resolves.toBe(true)
    await expect(getLockOwner(storage, 'doc-1')).resolves.toBe('alice')
  })

  it('claim by a different owner fails while held', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    await expect(claimLock(storage, 'doc-1', 'bob')).resolves.toBe(false)
    await expect(getLockOwner(storage, 'doc-1')).resolves.toBe('alice')
  })

  it('release by a non-owner fails and leaves the lock held', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    await expect(releaseLock(storage, 'doc-1', 'bob')).resolves.toBe(false)
    await expect(getLockOwner(storage, 'doc-1')).resolves.toBe('alice')
  })

  it('release by the owner succeeds and a subsequent claim by someone else then succeeds', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    await expect(releaseLock(storage, 'doc-1', 'alice')).resolves.toBe(true)
    await expect(getLockOwner(storage, 'doc-1')).resolves.toBeNull()
    await expect(claimLock(storage, 'doc-1', 'bob')).resolves.toBe(true)
  })

  it('getLockOwner returns null for a key that was never claimed', async () => {
    await expect(getLockOwner(storage, 'never-claimed')).resolves.toBeNull()
  })

  it('touches a lease on successful claim so the existing cleanup job can reap it', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    const lease = await storage.getItem<{ lastSeen: number }>('_lease:_lock:doc-1')
    expect(lease?.lastSeen).toBeCloseTo(Date.now(), -2)
  })

  it('does not touch a lease on a failed claim', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    await storage.removeItem('_lease:_lock:doc-1')

    await claimLock(storage, 'doc-1', 'bob') // fails, alice still owns it
    await expect(storage.getItem('_lease:_lock:doc-1')).resolves.toBeNull()
  })

  it('stores and returns the info passed to claim', async () => {
    await claimLock(storage, 'doc-1', 'alice', 'Alice')
    await expect(getLockOwnerInfo(storage, 'doc-1')).resolves.toBe('Alice')
  })

  it('stores and returns an arbitrary JSON-serializable owner info shape', async () => {
    await claimLock(storage, 'doc-1', 'alice', { name: 'Alice', avatarUrl: '/alice.png' })
    await expect(getLockOwnerInfo(storage, 'doc-1')).resolves.toEqual({ name: 'Alice', avatarUrl: '/alice.png' })
  })

  it('getLockOwnerInfo returns null when no info was given', async () => {
    await claimLock(storage, 'doc-1', 'alice')
    await expect(getLockOwnerInfo(storage, 'doc-1')).resolves.toBeNull()
  })

  it('getLockOwnerInfo returns null for a key that was never claimed', async () => {
    await expect(getLockOwnerInfo(storage, 'never-claimed')).resolves.toBeNull()
  })

  it('clears the owner info on release', async () => {
    await claimLock(storage, 'doc-1', 'alice', 'Alice')
    await releaseLock(storage, 'doc-1', 'alice')
    await expect(getLockOwnerInfo(storage, 'doc-1')).resolves.toBeNull()
  })

  it('does not clear the owner info when release fails', async () => {
    await claimLock(storage, 'doc-1', 'alice', 'Alice')
    await releaseLock(storage, 'doc-1', 'bob') // fails, alice still owns it
    await expect(getLockOwnerInfo(storage, 'doc-1')).resolves.toBe('Alice')
  })
})
