import { ref, onUnmounted, readonly, type Ref } from 'vue'
import { useNuxtApp } from '#app'
import type { PresenceChangedPayload, PresenceSnapshot } from '../types'

export interface UseRealtimePresenceOptions<TInfo> {
  /**
   * Opaque data shown to other room members (e.g. `{ name, avatarUrl }`). Given up front, this
   * client auto-joins the room on setup; omit it to only observe who else is present.
   */
  info?: TInfo
}

export interface UseRealtimePresenceReturn<TInfo> {
  /**
   * Current `{ [connectionId]: info }` for everyone present in the room.
   */
  members: Readonly<Ref<Record<string, TInfo>>>

  /**
   * Joins the room with the `info` given to this composable. No-op without `#app` (SSR).
   */
  join: () => Promise<void>

  /**
   * Leaves the room. Resolves once the server has acknowledged.
   */
  leave: () => Promise<void>
}

/**
 * Bulk "who's currently in room X" presence, independent of whether anyone holds a lock,
 * reuses the same opaque room string `useRealtimeLock`'s `room` option tags with.
 */
export function useRealtimePresence<TInfo = unknown>(room: string, options: UseRealtimePresenceOptions<TInfo> = {}): UseRealtimePresenceReturn<TInfo> {
  const socket = import.meta.client ? useNuxtApp().$realtimeSocket : null
  const members = ref<Record<string, TInfo>>({}) as Ref<Record<string, TInfo>>

  const handleChanged = (data: PresenceChangedPayload) => {
    if (data.room !== room) return
    if (data.info === null) {
      const { [data.connectionId]: _removed, ...rest } = members.value
      members.value = rest
    }
    else {
      members.value = { ...members.value, [data.connectionId]: data.info as TInfo }
    }
  }

  const join = (): Promise<void> => {
    if (!socket) return Promise.resolve()
    return new Promise((resolve) => {
      socket!.emit('presence:join', { room, info: options.info }, () => resolve())
    })
  }

  const leave = (): Promise<void> => {
    if (!socket) return Promise.resolve()
    return new Promise((resolve) => {
      socket!.emit('presence:leave', { room }, () => resolve())
    })
  }

  // Joins the room read-only and fetches the current snapshot, then (if info was given) also
  // registers this client as a member. Re-run on every reconnect since Socket.IO rooms don't
  // survive one.
  const subscribe = () => {
    socket!.emit('presence:subscribeRoom', room, (snapshot: PresenceSnapshot) => {
      members.value = snapshot as Record<string, TInfo>
    })
    if (options.info !== undefined) {
      join()
    }
  }

  if (socket) {
    subscribe()
    socket.on('presence:changed', handleChanged)
    socket.on('connect', subscribe)
  }

  onUnmounted(() => {
    if (!socket) return
    socket.off('presence:changed', handleChanged)
    socket.off('connect', subscribe)
    // Best-effort: don't block unmount on a server round-trip. A no-op on the server if this
    // client never joined (e.g. it only ever observed via subscribeRoom).
    socket.emit('presence:leave', { room }, () => {})
  })

  return {
    members: readonly(members) as Readonly<Ref<Record<string, TInfo>>>,
    join,
    leave,
  }
}
