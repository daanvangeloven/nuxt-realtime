import type { Storage } from 'unstorage'

const PRESENCE_PREFIX = '_presence:'
const CONN_ROOMS_PREFIX = '_connrooms:'

/**
 * Marks `connectionId` present in `room` with the given opaque `info`. One storage key per
 * member (not a shared array): join/leave only ever touch their own key, so concurrent joins
 * into the same room never race on a shared read-modify-write (see the room-index fix in
 * lock.ts for the bug this pattern avoids).
 */
export async function joinPresence(storage: Storage, room: string, connectionId: string, info: unknown = null): Promise<void> {
  await storage.setItem(`${PRESENCE_PREFIX}${room}:${connectionId}`, info)
  await storage.setItem(`${CONN_ROOMS_PREFIX}${connectionId}:${room}`, true)
}

/**
 * Removes `connectionId` from `room`. Returns whether it was actually present, so the caller
 * can skip broadcasting a leave for a connection that was never a member.
 */
export async function leavePresence(storage: Storage, room: string, connectionId: string): Promise<boolean> {
  const key = `${PRESENCE_PREFIX}${room}:${connectionId}`
  const existed = await storage.hasItem(key)
  if (existed) {
    await storage.removeItem(key)
  }
  await storage.removeItem(`${CONN_ROOMS_PREFIX}${connectionId}:${room}`)
  return existed
}

/**
 * Returns the current `{ [connectionId]: info }` snapshot for everyone present in `room`.
 */
export async function getPresenceSnapshot(storage: Storage, room: string): Promise<Record<string, unknown>> {
  const prefix = `${PRESENCE_PREFIX}${room}:`
  const keys = await storage.getKeys(prefix)
  const snapshot: Record<string, unknown> = {}
  for (const key of keys) {
    snapshot[key.slice(prefix.length)] = await storage.getItem(key)
  }
  return snapshot
}

/**
 * Returns every room `connectionId` is currently present in, used by the connection-registry
 * grace-period sweep to leave presence in every room a stale connection was part of, without
 * scanning all rooms.
 */
export async function getRoomsForConnection(storage: Storage, connectionId: string): Promise<string[]> {
  const prefix = `${CONN_ROOMS_PREFIX}${connectionId}:`
  const keys = await storage.getKeys(prefix)
  return keys.map(k => k.slice(prefix.length))
}
