import { describe, it, expect, beforeEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { joinRoom, leaveRoom, getRoomsForConnection } from './room-registry'

function createTestStorage(): Storage {
  const root = createStorage({ driver: memoryDriver() })
  root.mount('nuxt-realtime', memoryDriver())
  return prefixStorage(root, 'nuxt-realtime')
}

describe('room-registry', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createTestStorage()
  })

  describe('joinRoom', () => {
    it('reports firstMember:true for the first join into an empty room', async () => {
      await expect(joinRoom(storage, 'room-a', 'conn-1')).resolves.toEqual({ alreadyMember: false, firstMember: true })
    })

    it('reports firstMember:false for a second, different connection joining', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await expect(joinRoom(storage, 'room-a', 'conn-2')).resolves.toEqual({ alreadyMember: false, firstMember: false })
    })

    it('re-joining is a no-op reported as alreadyMember:true', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await expect(joinRoom(storage, 'room-a', 'conn-1')).resolves.toEqual({ alreadyMember: true, firstMember: false })
    })

    it('concurrent joins into the same room never lose a membership, even on the naive fallback driver (each membership is its own key)', async () => {
      // Membership itself (unlike firstMember detection below) needs no CAS to stay correct
      // under concurrency, each join only ever writes its own key.
      await Promise.all([
        joinRoom(storage, 'room-a', 'conn-1'),
        joinRoom(storage, 'room-a', 'conn-2'),
        joinRoom(storage, 'room-a', 'conn-3'),
      ])
      await expect(getRoomsForConnection(storage, 'conn-1')).resolves.toContain('room-a')
      await expect(getRoomsForConnection(storage, 'conn-2')).resolves.toContain('room-a')
      await expect(getRoomsForConnection(storage, 'conn-3')).resolves.toContain('room-a')
    })

    it('sequential joins into the same room report firstMember exactly once', async () => {
      const a = await joinRoom(storage, 'room-a', 'conn-1')
      const b = await joinRoom(storage, 'room-a', 'conn-2')
      const c = await joinRoom(storage, 'room-a', 'conn-3')
      expect([a, b, c].filter(r => r.firstMember)).toHaveLength(1)
    })

    it('concurrent joins report firstMember exactly once', async () => {
      // claimOnce's write-then-verify guarantees exactly one winner under Promise.all on any
      // storage driver, plain memory included: see the equivalent test in lock.test.ts for why
      // this is a guarantee of the microtask ordering, not a timing-dependent flake.
      const results = await Promise.all([
        joinRoom(storage, 'room-a', 'conn-1'),
        joinRoom(storage, 'room-a', 'conn-2'),
        joinRoom(storage, 'room-a', 'conn-3'),
      ])
      expect(results.filter(r => r.firstMember)).toHaveLength(1)
    })

    it('re-firing: after a room empties, the next join reports firstMember again', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await leaveRoom(storage, 'room-a', 'conn-1')
      await expect(joinRoom(storage, 'room-a', 'conn-2')).resolves.toEqual({ alreadyMember: false, firstMember: true })
    })
  })

  describe('leaveRoom', () => {
    it('reports nowEmpty:true when the last member leaves', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await expect(leaveRoom(storage, 'room-a', 'conn-1')).resolves.toEqual({ left: true, nowEmpty: true })
    })

    it('reports nowEmpty:false when other members remain', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await joinRoom(storage, 'room-a', 'conn-2')
      await expect(leaveRoom(storage, 'room-a', 'conn-1')).resolves.toEqual({ left: true, nowEmpty: false })
    })

    it('reports left:false for a connectionId that was never a member, and touches nothing', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await expect(leaveRoom(storage, 'room-a', 'conn-2')).resolves.toEqual({ left: false, nowEmpty: false })
      await expect(getRoomsForConnection(storage, 'conn-1')).resolves.toEqual(['room-a'])
    })

    it('leaving one room does not affect membership in another', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await joinRoom(storage, 'room-b', 'conn-1')
      await leaveRoom(storage, 'room-a', 'conn-1')
      await expect(getRoomsForConnection(storage, 'conn-1')).resolves.toEqual(['room-b'])
    })

    it('concurrent last-member leaves report nowEmpty exactly once', async () => {
      await Promise.all([
        joinRoom(storage, 'room-a', 'conn-1'),
        joinRoom(storage, 'room-a', 'conn-2'),
        joinRoom(storage, 'room-a', 'conn-3'),
      ])
      const results = await Promise.all([
        leaveRoom(storage, 'room-a', 'conn-1'),
        leaveRoom(storage, 'room-a', 'conn-2'),
        leaveRoom(storage, 'room-a', 'conn-3'),
      ])
      expect(results.filter(r => r.nowEmpty)).toHaveLength(1)
    })
  })

  describe('getRoomsForConnection', () => {
    it('returns an empty array for a connectionId in no rooms', async () => {
      await expect(getRoomsForConnection(storage, 'never-joined')).resolves.toEqual([])
    })

    it('lists every room a connectionId is a member of', async () => {
      await joinRoom(storage, 'room-a', 'conn-1')
      await joinRoom(storage, 'room-b', 'conn-1')
      const rooms = await getRoomsForConnection(storage, 'conn-1')
      expect(rooms.sort()).toEqual(['room-a', 'room-b'])
    })
  })
})
