import type { Storage } from 'unstorage'
import { claimOnce } from './lock'

const MEMBER_PREFIX = '_roommember:'
const MEMBER_ROOMS_PREFIX = '_memberrooms:'
const CREATED_MARKER_PREFIX = '_roomcreated:'
const CLOSING_PREFIX = '_roomclosing:'
// Bounds how long a crashed leaveRoom call (won the mutex, never released it) can block a
// room's *next* empty-transition. Short because it's only ever held for a getKeys + a removeItem.
const CLOSING_MUTEX_TTL_MS = 5000

/**
 * Whether `connectionId` is currently a member of `roomId`, without joining it.
 */
export async function isRoomMember(storage: Storage, roomId: string, connectionId: string): Promise<boolean> {
  return storage.hasItem(`${MEMBER_PREFIX}${roomId}:${connectionId}`)
}

/**
 * Marks `connectionId` a member of `roomId`. One storage key per membership (not a shared
 * array), so joins into the same room never race on a shared read-modify-write.
 *
 * `firstMember` is determined via `claimOnce`, a real atomic compare-and-set on a CAS-capable
 * driver (e.g. Redis), so concurrent joins across server instances still report exactly one
 * winner. On the naive fallback driver this is best-effort under truly simultaneous joins,
 * same documented tradeoff as `claimLock` itself. Re-joining a room you're already in is a
 * no-op.
 */
export async function joinRoom(storage: Storage, roomId: string, connectionId: string): Promise<{ alreadyMember: boolean, firstMember: boolean }> {
  const key = `${MEMBER_PREFIX}${roomId}:${connectionId}`
  const alreadyMember = await storage.hasItem(key)
  if (alreadyMember) {
    return { alreadyMember: true, firstMember: false }
  }

  const firstMember = await claimOnce(storage, `${CREATED_MARKER_PREFIX}${roomId}`, connectionId)
  await storage.setItem(key, true)
  await storage.setItem(`${MEMBER_ROOMS_PREFIX}${connectionId}:${roomId}`, true)
  return { alreadyMember: false, firstMember }
}

/**
 * Removes `connectionId` from `roomId`. `left` is whether it was actually a member; `nowEmpty`
 * is true when this leave takes the room from 1 to 0 members, the signal for
 * `nuxt-realtime:roomEmpty`. Also clears the room-creation claim so a future 0→1 join into the
 * same roomId correctly reports firstMember again.
 *
 * Counting remaining members and reacting to zero is only safe done by one leaver at a time:
 * two concurrent last-member leaves (e.g. across two server instances) could otherwise both
 * observe zero and both report `nowEmpty`, double-firing `nuxt-realtime:roomEmpty`. The
 * `CLOSING_PREFIX` claim (same CAS primitive `firstMember` detection uses) makes that check +
 * clear a mutually-exclusive critical section instead.
 */
export async function leaveRoom(storage: Storage, roomId: string, connectionId: string): Promise<{ left: boolean, nowEmpty: boolean }> {
  const key = `${MEMBER_PREFIX}${roomId}:${connectionId}`
  const left = await storage.hasItem(key)
  if (!left) {
    return { left: false, nowEmpty: false }
  }

  await storage.removeItem(key)
  await storage.removeItem(`${MEMBER_ROOMS_PREFIX}${connectionId}:${roomId}`)

  const closingKey = `${CLOSING_PREFIX}${roomId}`
  const wonClosingCheck = await claimOnce(storage, closingKey, connectionId, CLOSING_MUTEX_TTL_MS)
  if (!wonClosingCheck) {
    return { left: true, nowEmpty: false }
  }
  try {
    const remaining = (await storage.getKeys(`${MEMBER_PREFIX}${roomId}:`)).length
    const nowEmpty = remaining === 0
    if (nowEmpty) {
      await storage.removeItem(`${CREATED_MARKER_PREFIX}${roomId}`)
    }
    return { left: true, nowEmpty }
  }
  finally {
    await storage.removeItem(closingKey)
  }
}

/**
 * Returns every room `connectionId` is currently a member of, used by the connection-registry
 * grace-period sweep to leave every room a stale connection was part of, without scanning all
 * rooms.
 */
export async function getRoomsForConnection(storage: Storage, connectionId: string): Promise<string[]> {
  const prefix = `${MEMBER_ROOMS_PREFIX}${connectionId}:`
  const keys = await storage.getKeys(prefix)
  return keys.map(k => k.slice(prefix.length))
}
