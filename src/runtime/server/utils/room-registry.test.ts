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

    it('concurrent joins report firstMember exactly once on a driver with real atomic claimLock (e.g. Redis)', async () => {
      // A minimal synchronous CAS driver, standing in for the real Lua-script atomicity
      // reactiveRedisDriver provides, proves firstMember detection is genuinely race-free
      // once the underlying driver can claim atomically, unlike the naive fallback above.
      const claims = new Map<string, string>()
      const casDriver = {
        ...memoryDriver(),
        claimLock: async (key: string, owner: string) => {
          if (claims.has(key) && claims.get(key) !== owner) return false
          claims.set(key, owner)
          return true
        },
      }
      const root = createStorage({ driver: memoryDriver() })
      root.mount('nuxt-realtime', casDriver)
      const scoped = prefixStorage(root, 'nuxt-realtime')

      const results = await Promise.all([
        joinRoom(scoped, 'room-a', 'conn-1'),
        joinRoom(scoped, 'room-a', 'conn-2'),
        joinRoom(scoped, 'room-a', 'conn-3'),
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

    it('concurrent last-member leaves report nowEmpty exactly once on a driver with real atomic claimLock (e.g. Redis)', async () => {
      const claims = new Map<string, string>()
      const casDriver = {
        ...memoryDriver(),
        claimLock: async (key: string, owner: string) => {
          if (claims.has(key) && claims.get(key) !== owner) return false
          claims.set(key, owner)
          return true
        },
      }
      const root = createStorage({ driver: memoryDriver() })
      root.mount('nuxt-realtime', casDriver)
      const scoped = prefixStorage(root, 'nuxt-realtime')

      await Promise.all([
        joinRoom(scoped, 'room-a', 'conn-1'),
        joinRoom(scoped, 'room-a', 'conn-2'),
        joinRoom(scoped, 'room-a', 'conn-3'),
      ])
      const results = await Promise.all([
        leaveRoom(scoped, 'room-a', 'conn-1'),
        leaveRoom(scoped, 'room-a', 'conn-2'),
        leaveRoom(scoped, 'room-a', 'conn-3'),
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
