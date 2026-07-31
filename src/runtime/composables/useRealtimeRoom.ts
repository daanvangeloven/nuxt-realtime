import { ref, onUnmounted, readonly, type Ref } from 'vue'
import { useNuxtApp } from '#app'
import { useRealtimeLock, type UseRealtimeLockOptions, type UseRealtimeLockReturn } from './useRealtimeLock'
import { useRealtimeLockRoom, type UseRealtimeLockRoomReturn } from './useRealtimeLockRoom'
import { useRealtimePresence, type UseRealtimePresenceOptions, type UseRealtimePresenceReturn } from './useRealtimePresence'
import { useRealtimeState, type useRealtimeStateOptions, type UseRealtimeStateReturn } from './useRealtimeState'
import { useRealtimeEvents, type UseRealtimeEventsOptions, type UseRealtimeEventsReturn } from './useRealtimeEvents'
import type { RoomAckResponse } from '../types'

export interface UseRealtimeRoomReturn {
  /**
   * Whether this client is currently a member of the room (reflects the last join/leave ack).
   */
  joined: Readonly<Ref<boolean>>

  /**
   * Explicitly joins the room. Gated server-side by `nuxt-realtime:canJoinRoom` (allowed by
   * default). Resolves to whether the join succeeded.
   */
  join: () => Promise<boolean>

  /**
   * Leaves the room. Resolves once the server has acknowledged.
   */
  leave: () => Promise<void>

  /** Presence scoped to this room, same as `useRealtimePresence(roomId, options)`. */
  presence: <TInfo = unknown>(options?: UseRealtimePresenceOptions<TInfo>) => UseRealtimePresenceReturn<TInfo>

  /** A lock scoped to this room, same as `useRealtimeLock(key, { ...options, room: roomId })`. */
  lock: <TOwnerInfo = string>(key: string, options?: Omit<UseRealtimeLockOptions<TOwnerInfo>, 'room'>) => UseRealtimeLockReturn<TOwnerInfo>

  /**
   * Bulk, read-only view of every lock currently tagged with this room, same as
   * `useRealtimeLockRoom(roomId)`. Use this for a list/overview showing lock status across
   * many keys at once; use `lock(key)` to claim/release one specific key.
   */
  locks: () => UseRealtimeLockRoomReturn

  /**
   * Storage scoped to this room, a thin client-side convenience that namespaces `key` under
   * the room id and delegates to `useRealtimeState`. No new server protocol.
   */
  state: <T>(key: string, defaultValue?: T, options?: useRealtimeStateOptions) => UseRealtimeStateReturn<T>

  /**
   * Event pub/sub scoped to this room, namespaces the channel under the room id and delegates
   * to `useRealtimeEvents`. No new server protocol: the existing colon-hierarchy wildcard rooms
   * already nest `{roomId}:foo` under `{roomId}:*`.
   */
  events: <TEventMap = Record<string, unknown>>(options?: UseRealtimeEventsOptions) => UseRealtimeEventsReturn<TEventMap>
}

/**
 * Explicit room concept scoping state, events, presence, and locks together, with server-side
 * lifecycle hooks (`nuxt-realtime:roomCreated`/`nuxt-realtime:roomEmpty`) and a single auth
 * checkpoint (`nuxt-realtime:canJoinRoom`) instead of gating every handler individually.
 *
 * Standalone `useRealtimeLock(key, { room })`/`useRealtimePresence(room)` keep working
 * unchanged without ever calling this; they pass through the same server-side membership/auth
 * path implicitly. `useRealtimeRoom` is a convenience layer on top, not a requirement.
 */
export function useRealtimeRoom(roomId: string): UseRealtimeRoomReturn {
  const socket = import.meta.client ? useNuxtApp().$realtimeSocket : null
  const joined = ref(false)

  const join = (): Promise<boolean> => {
    if (!socket) return Promise.resolve(false)
    return new Promise((resolve) => {
      socket!.emit('room:join', roomId, (response: RoomAckResponse) => {
        joined.value = response.success
        resolve(response.success)
      })
    })
  }

  const leave = (): Promise<void> => {
    if (!socket) return Promise.resolve()
    return new Promise((resolve) => {
      socket!.emit('room:leave', roomId, () => {
        joined.value = false
        resolve()
      })
    })
  }

  if (socket) {
    join()
    // Socket.IO rooms don't survive a reconnect, so the join has to be redone.
    socket.on('connect', join)
  }

  onUnmounted(() => {
    if (!socket) return
    socket.off('connect', join)
    // Best-effort: don't block unmount on a server round-trip.
    socket.emit('room:leave', roomId, () => {})
  })

  return {
    joined: readonly(joined),
    join,
    leave,
    presence: options => useRealtimePresence(roomId, options),
    lock: (key, options) => useRealtimeLock(key, { ...options, room: roomId }),
    locks: () => useRealtimeLockRoom(roomId),
    state: (key, defaultValue, options) => useRealtimeState(`room:${roomId}:${key}`, defaultValue as never, options),
    events: (options) => {
      const inner = useRealtimeEvents(options)
      return {
        subscribe: (channel, callback) => inner.subscribe(`${roomId}:${channel}` as never, callback as never),
        publish: (channel, data, publishOptions) => inner.publish(`${roomId}:${channel}` as never, data, publishOptions),
        unsubscribe: (channel: string) => inner.unsubscribe(`${roomId}:${channel}`),
      }
    },
  }
}
