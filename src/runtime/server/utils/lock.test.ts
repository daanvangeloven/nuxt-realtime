import { describe, it, expect, beforeEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { claimLock, releaseLock, getLockOwner, getLockOwnerInfo, getLockRoom, getRoomKeys, getLocksOwnedBy } from './lock'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

  describe('ttl', () => {
    it('claims are unbounded when no ttl is given', async () => {
      await claimLock(storage, 'doc-1', 'alice')
      await wait(20)
      await expect(claimLock(storage, 'doc-1', 'bob')).resolves.toBe(false)
    })

    it('a different owner can claim once the ttl lapses', async () => {
      await claimLock(storage, 'doc-1', 'alice', undefined, { ttl: 20 })
      await expect(claimLock(storage, 'doc-1', 'bob')).resolves.toBe(false)
      await wait(30)
      await expect(claimLock(storage, 'doc-1', 'bob')).resolves.toBe(true)
      await expect(getLockOwner(storage, 'doc-1')).resolves.toBe('bob')
    })

    it('getLockOwner reports an expired lock as free without a claim attempt', async () => {
      await claimLock(storage, 'doc-1', 'alice', undefined, { ttl: 20 })
      await wait(30)
      await expect(getLockOwner(storage, 'doc-1')).resolves.toBeNull()
    })
  })

  describe('room', () => {
    it('tags a lock with a room and lists it via getRoomKeys', async () => {
      await claimLock(storage, 'doc-1', 'alice', undefined, { room: 'project-42' })
      await expect(getRoomKeys(storage, 'project-42')).resolves.toEqual(['doc-1'])
      await expect(getLockRoom(storage, 'doc-1')).resolves.toBe('project-42')
    })

    it('accumulates multiple keys tagged with the same room', async () => {
      await claimLock(storage, 'doc-1', 'alice', undefined, { room: 'project-42' })
      await claimLock(storage, 'doc-2', 'bob', undefined, { room: 'project-42' })
      await expect(getRoomKeys(storage, 'project-42')).resolves.toEqual(['doc-1', 'doc-2'])
    })

    it('removes the key from the room index on release', async () => {
      await claimLock(storage, 'doc-1', 'alice', undefined, { room: 'project-42' })
      await releaseLock(storage, 'doc-1', 'alice')
      await expect(getRoomKeys(storage, 'project-42')).resolves.toEqual([])
      await expect(getLockRoom(storage, 'doc-1')).resolves.toBeNull()
    })

    it('does not tag a room when none is given', async () => {
      await claimLock(storage, 'doc-1', 'alice')
      await expect(getLockRoom(storage, 'doc-1')).resolves.toBeNull()
    })

    it('concurrent claims into the same room do not clobber each other (each membership is its own key, not a shared array)', async () => {
      await Promise.all([
        claimLock(storage, 'doc-1', 'alice', undefined, { room: 'project-42' }),
        claimLock(storage, 'doc-2', 'bob', undefined, { room: 'project-42' }),
        claimLock(storage, 'doc-3', 'carol', undefined, { room: 'project-42' }),
      ])
      const keys = await getRoomKeys(storage, 'project-42')
      expect(keys.sort()).toEqual(['doc-1', 'doc-2', 'doc-3'])
    })
  })

  describe('getLocksOwnedBy', () => {
    it('returns only the keys currently held by the given owner', async () => {
      await claimLock(storage, 'doc-1', 'alice')
      await claimLock(storage, 'doc-2', 'alice')
      await claimLock(storage, 'doc-3', 'bob')
      await expect(getLocksOwnedBy(storage, 'alice')).resolves.toEqual(['doc-1', 'doc-2'])
    })

    it('returns an empty array when the owner holds nothing', async () => {
      await expect(getLocksOwnedBy(storage, 'alice')).resolves.toEqual([])
    })

    it('no longer lists a key after it is released', async () => {
      await claimLock(storage, 'doc-1', 'alice')
      await releaseLock(storage, 'doc-1', 'alice')
      await expect(getLocksOwnedBy(storage, 'alice')).resolves.toEqual([])
    })

    it('a lock claimed and released by a second owner is not still listed under the first', async () => {
      await claimLock(storage, 'doc-1', 'alice', undefined, { ttl: 20 })
      await wait(30) // let alice's ttl lapse
      await claimLock(storage, 'doc-1', 'bob')
      await expect(getLocksOwnedBy(storage, 'alice')).resolves.toEqual([])
      await expect(getLocksOwnedBy(storage, 'bob')).resolves.toEqual(['doc-1'])
    })
  })
})
