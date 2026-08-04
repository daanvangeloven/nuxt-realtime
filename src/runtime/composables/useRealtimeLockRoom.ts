import { ref, onUnmounted, readonly, type Ref } from 'vue'
import { useNuxtApp } from '#app'
import type { LockChangedPayload, LockRoomSnapshot } from '../types'

export interface UseRealtimeLockRoomReturn {
  /**
   * Current `{ [key]: { owner, ownerInfo } }` state for every lock tagged with this room.
   * Keys with no entry are unlocked.
   */
  locks: Readonly<Ref<LockRoomSnapshot>>
}

/**
 * Bulk presence for every lock tagged with `room` at claim time (see `useRealtimeLock`'s
 * `room` option), fetches a snapshot once, then applies live `lock:changed` diffs, without
 * having to subscribe to each key individually.
 */
export function useRealtimeLockRoom(room: string): UseRealtimeLockRoomReturn {
  const socket = import.meta.client ? useNuxtApp().$realtimeSocket : null
  const locks = ref<LockRoomSnapshot>({}) as Ref<LockRoomSnapshot>

  const handleLockChanged = (data: LockChangedPayload) => {
    if (data.room !== room) return
    if (data.owner === null) {
      const { [data.key]: _removed, ...rest } = locks.value
      locks.value = rest
    }
    else {
      locks.value = { ...locks.value, [data.key]: { owner: data.owner, ownerInfo: data.ownerInfo } }
    }
  }

  const subscribe = () => {
    socket!.emit('lock:subscribeRoom', room, (snapshot: LockRoomSnapshot) => {
      locks.value = snapshot
    })
  }

  if (socket) {
    subscribe()
    socket.on('lock:changed', handleLockChanged)
    // Socket.IO rooms don't survive a reconnect, so the room join has to be redone.
    socket.on('connect', subscribe)
  }

  onUnmounted(() => {
    if (!socket) return
    socket.off('lock:changed', handleLockChanged)
    socket.off('connect', subscribe)
    socket.emit('lock:unsubscribeRoom', room)
  })

  return {
    locks: readonly(locks),
  }
}
