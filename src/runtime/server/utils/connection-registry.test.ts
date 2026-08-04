import { describe, it, expect, beforeEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { createConnectionRegistry, type ConnectionRegistry } from './connection-registry'

function createTestStorage(): Storage {
  const root = createStorage({ driver: memoryDriver() })
  root.mount('nuxt-realtime', memoryDriver())
  return prefixStorage(root, 'nuxt-realtime')
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('ConnectionRegistry', () => {
  let storage: Storage
  let registry: ConnectionRegistry

  beforeEach(() => {
    storage = createTestStorage()
    registry = createConnectionRegistry(storage, { staleGraceMs: 50 })
  })

  it('registers a fresh connection and can look it up', async () => {
    await registry.register('conn-1', 'socket-a', { name: 'Alice' })
    await expect(registry.lookup('conn-1')).resolves.toEqual({ socketId: 'socket-a', info: { name: 'Alice' }, staleAt: null })
  })

  it('lookup returns null for an unknown connectionId', async () => {
    await expect(registry.lookup('never-registered')).resolves.toBeNull()
  })

  it('markStale sets staleAt without touching socketId/info', async () => {
    await registry.register('conn-1', 'socket-a', { name: 'Alice' })
    await registry.markStale('conn-1', 'socket-a')
    const record = await registry.lookup('conn-1')
    expect(record?.staleAt).not.toBeNull()
    expect(record?.socketId).toBe('socket-a')
    expect(record?.info).toEqual({ name: 'Alice' })
  })

  it('markStale on an unknown connectionId is a no-op', async () => {
    await registry.markStale('never-registered', 'socket-a')
    await expect(registry.lookup('never-registered')).resolves.toBeNull()
  })

  it('markStale ignores a disconnect for a socketId that has since been superseded by a reclaim', async () => {
    await registry.register('conn-1', 'socket-a', { name: 'Alice' })
    await registry.markStale('conn-1', 'socket-a')
    await registry.reclaim('conn-1', 'socket-b')

    // A late/reordered disconnect event for the old socket-a must not re-stale socket-b's record.
    await registry.markStale('conn-1', 'socket-a')
    const record = await registry.lookup('conn-1')
    expect(record).toEqual({ socketId: 'socket-b', info: { name: 'Alice' }, staleAt: null })
  })

  it('reclaim clears staleness and updates the socketId, preserving info', async () => {
    await registry.register('conn-1', 'socket-a', { name: 'Alice' })
    await registry.markStale('conn-1', 'socket-a')

    await expect(registry.reclaim('conn-1', 'socket-b')).resolves.toBe(true)
    const record = await registry.lookup('conn-1')
    expect(record).toEqual({ socketId: 'socket-b', info: { name: 'Alice' }, staleAt: null })
  })

  it('reclaim on a never-registered connectionId returns false and registers nothing', async () => {
    await expect(registry.reclaim('conn-1', 'socket-a')).resolves.toBe(false)
    await expect(registry.lookup('conn-1')).resolves.toBeNull()
  })

  it('concurrent reclaims of the same stale connectionId report exactly one winner', async () => {
    // The reclaim mutex is claimOnce's optimistic write-then-verify, race-free under
    // Promise.all on any storage driver, plain memory included (see lock.test.ts).
    await registry.register('conn-1', 'socket-a', { name: 'Alice' })
    await registry.markStale('conn-1', 'socket-a')

    const results = await Promise.all([
      registry.reclaim('conn-1', 'socket-b'),
      registry.reclaim('conn-1', 'socket-c'),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    const record = await registry.lookup('conn-1')
    expect(record?.staleAt).toBeNull()
    expect(['socket-b', 'socket-c']).toContain(record?.socketId)
  })

  it('reclaim on a still-active connectionId returns false and does not steal it from the live socket', async () => {
    await registry.register('conn-1', 'socket-a', { name: 'Alice' })

    await expect(registry.reclaim('conn-1', 'socket-b')).resolves.toBe(false)
    await expect(registry.lookup('conn-1')).resolves.toEqual({ socketId: 'socket-a', info: { name: 'Alice' }, staleAt: null })
  })

  it('isGraceExpired is false while active (staleAt null)', async () => {
    await registry.register('conn-1', 'socket-a')
    const record = await registry.lookup('conn-1')
    expect(registry.isGraceExpired(record!)).toBe(false)
  })

  it('isGraceExpired is false just after going stale, true once staleGraceMs has passed', async () => {
    await registry.register('conn-1', 'socket-a')
    await registry.markStale('conn-1', 'socket-a')
    const record = await registry.lookup('conn-1')

    expect(registry.isGraceExpired(record!)).toBe(false)
    await wait(70)
    expect(registry.isGraceExpired(record!)).toBe(true)
  })

  it('remove deletes the entry', async () => {
    await registry.register('conn-1', 'socket-a')
    await registry.remove('conn-1')
    await expect(registry.lookup('conn-1')).resolves.toBeNull()
  })

  it('listIds returns every registered connectionId', async () => {
    await registry.register('conn-1', 'socket-a')
    await registry.register('conn-2', 'socket-b')
    await expect(registry.listIds()).resolves.toEqual(expect.arrayContaining(['conn-1', 'conn-2']))
  })
})
