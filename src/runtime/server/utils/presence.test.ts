import { describe, it, expect, beforeEach } from 'vitest'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { joinPresence, leavePresence, getPresenceSnapshot, getRoomsForConnection } from './presence'

function createTestStorage(): Storage {
  const root = createStorage({ driver: memoryDriver() })
  root.mount('nuxt-realtime', memoryDriver())
  return prefixStorage(root, 'nuxt-realtime')
}

describe('presence', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createTestStorage()
  })

  it('joining adds the connectionId to the room snapshot', async () => {
    await joinPresence(storage, 'project-42', 'conn-1', { name: 'Alice' })
    await expect(getPresenceSnapshot(storage, 'project-42')).resolves.toEqual({ 'conn-1': { name: 'Alice' } })
  })

  it('defaults info to null when omitted', async () => {
    await joinPresence(storage, 'project-42', 'conn-1')
    await expect(getPresenceSnapshot(storage, 'project-42')).resolves.toEqual({ 'conn-1': null })
  })

  it('accumulates multiple members in the same room', async () => {
    await joinPresence(storage, 'project-42', 'conn-1', 'Alice')
    await joinPresence(storage, 'project-42', 'conn-2', 'Bob')
    await expect(getPresenceSnapshot(storage, 'project-42')).resolves.toEqual({ 'conn-1': 'Alice', 'conn-2': 'Bob' })
  })

  it('concurrent joins into the same room do not clobber each other (each membership is its own key)', async () => {
    await Promise.all([
      joinPresence(storage, 'project-42', 'conn-1', 'Alice'),
      joinPresence(storage, 'project-42', 'conn-2', 'Bob'),
      joinPresence(storage, 'project-42', 'conn-3', 'Carol'),
    ])
    const snapshot = await getPresenceSnapshot(storage, 'project-42')
    expect(Object.keys(snapshot).sort()).toEqual(['conn-1', 'conn-2', 'conn-3'])
  })

  it('leave removes the member and returns true when they were present', async () => {
    await joinPresence(storage, 'project-42', 'conn-1', 'Alice')
    await expect(leavePresence(storage, 'project-42', 'conn-1')).resolves.toBe(true)
    await expect(getPresenceSnapshot(storage, 'project-42')).resolves.toEqual({})
  })

  it('leave returns false for a connectionId that was never present, and touches nothing', async () => {
    await joinPresence(storage, 'project-42', 'conn-1', 'Alice')
    await expect(leavePresence(storage, 'project-42', 'conn-2')).resolves.toBe(false)
    await expect(getPresenceSnapshot(storage, 'project-42')).resolves.toEqual({ 'conn-1': 'Alice' })
  })

  it('leave does not affect other rooms the same connectionId is present in', async () => {
    await joinPresence(storage, 'room-a', 'conn-1', 'Alice')
    await joinPresence(storage, 'room-b', 'conn-1', 'Alice')
    await leavePresence(storage, 'room-a', 'conn-1')
    await expect(getPresenceSnapshot(storage, 'room-a')).resolves.toEqual({})
    await expect(getPresenceSnapshot(storage, 'room-b')).resolves.toEqual({ 'conn-1': 'Alice' })
  })

  describe('getRoomsForConnection', () => {
    it('lists every room a connectionId is currently present in', async () => {
      await joinPresence(storage, 'room-a', 'conn-1')
      await joinPresence(storage, 'room-b', 'conn-1')
      await joinPresence(storage, 'room-a', 'conn-2')

      await expect(getRoomsForConnection(storage, 'conn-1')).resolves.toEqual(expect.arrayContaining(['room-a', 'room-b']))
      const conn1Rooms = await getRoomsForConnection(storage, 'conn-1')
      expect(conn1Rooms).toHaveLength(2)
    })

    it('drops a room from the list once the connection leaves it', async () => {
      await joinPresence(storage, 'room-a', 'conn-1')
      await joinPresence(storage, 'room-b', 'conn-1')
      await leavePresence(storage, 'room-a', 'conn-1')
      await expect(getRoomsForConnection(storage, 'conn-1')).resolves.toEqual(['room-b'])
    })

    it('returns an empty array for a connectionId present in no rooms', async () => {
      await expect(getRoomsForConnection(storage, 'never-joined')).resolves.toEqual([])
    })
  })
})
