import { ref, onUnmounted, readonly, type Ref } from 'vue'
import { useNuxtApp } from '#app'
import type { LockChangedPayload, LockClaimResponse, LockForceReleaseResponse, LockReleaseResponse } from '../types'
import { useRealtimeLogger } from './useRealtimeLogger'

export interface UseRealtimeLockOptions<TOwnerInfo> {
  /**
   * Info about this client to show others while it holds the lock (e.g. `{ name, avatarUrl }`)
   */
  ownerInfo?: TOwnerInfo

  /**
   * Opaque group tag for bulk presence via useRealtimeLockRoom. Not a route/URL concept.
   */
  room?: string

  /**
   * Auto-release after this many ms of being held, regardless of activity.
   * Omitted = the module-level `lock.defaultTtl` (if any), 0 = never expires.
   */
  ttl?: number

  /**
   * Called whenever the lock becomes free
   */
  onReleased?: (payload: { changed: boolean }) => void
}

export interface UseRealtimeLockReturn<TOwnerInfo> {
  /**
   * Attempts to claim the lock. Succeeds if it's currently free or already owned by this client.
   */
  claim: () => Promise<boolean>

  /**
   * Releases the lock. Resolves once the server has acknowledged; no-op if this client doesn't own it.
   *
   * `options.changed` - whether the release follows an actual value change, so other
   * clients' `onReleased` can distinguish that from abandoning an edit.
   * `options.meta` - opaque app data (e.g. a diff) relayed verbatim to other clients' `onReleased`-adjacent `lock:changed`.
   */
  release: (options?: { changed?: boolean, meta?: unknown }) => Promise<void>

  /**
   * Forcibly releases the lock regardless of who holds it. Denied unless the server has a
   * `nuxt-realtime:canForceRelease` hook registered that allows it.
   */
  forceRelease: () => Promise<boolean>

  /**
   * Whether this client currently owns the lock.
   */
  ownedByMe: Readonly<Ref<boolean>>

  /**
   * Whether anyone (not necessarily this client) currently owns the lock.
   */
  locked: Readonly<Ref<boolean>>

  /**
   * Info about the current holder passed to their `claim()`, or null if unlocked or unknown.
   */
  ownerInfo: Readonly<Ref<TOwnerInfo | null>>
}

const ACK_TIMEOUT = 5000

export function useRealtimeLock<TOwnerInfo = string>(key: string, options: UseRealtimeLockOptions<TOwnerInfo> = {}): UseRealtimeLockReturn<TOwnerInfo> {
  const nuxtApp = import.meta.client ? useNuxtApp() : null
  const socket = nuxtApp?.$realtimeSocket ?? null
  const connectionId = nuxtApp?.$realtimeConnectionId ?? null
  const logger = import.meta.client ? useRealtimeLogger() : null

  const locked = ref(false)
  const ownedByMe = ref(false)
  const ownerInfo = ref(null) as Ref<TOwnerInfo | null>

  const applyState = (owner: string | null, info: TOwnerInfo | null = null) => {
    locked.value = owner !== null
    ownedByMe.value = owner !== null && owner === connectionId?.value
    ownerInfo.value = owner !== null ? info : null
  }

  const handleLockChanged = (data: LockChangedPayload) => {
    if (data.key !== key) return
    applyState(data.owner, (data.ownerInfo as TOwnerInfo | undefined) ?? null)
    if (data.owner === null) {
      options.onReleased?.({ changed: data.changed ?? false })
    }
  }

  // Joins the lock's room and fetches the current state in the same round-trip.
  const subscribe = () => {
    socket!.emit('lock:subscribe', key, (state: LockChangedPayload) => applyState(state.owner, (state.ownerInfo as TOwnerInfo | undefined) ?? null))
  }

  if (socket) {
    subscribe()
    socket.on('lock:changed', handleLockChanged)
    // Socket.IO rooms don't survive a reconnect, so the room join has to be redone.
    socket.on('connect', subscribe)
  }

  const claim = (): Promise<boolean> => {
    if (!socket) return Promise.resolve(false)
    return new Promise((resolve) => {
      socket
        .timeout(ACK_TIMEOUT)
        .emit('lock:claim', { key, ownerInfo: options.ownerInfo, room: options.room, ttl: options.ttl }, (err: Error, response: LockClaimResponse) => {
          if (err || !response?.success) {
            logger?.error('Failed to claim lock:', err || response?.error)
            resolve(false)
            return
          }
          locked.value = true
          ownedByMe.value = response.owned
          ownerInfo.value = response.owned ? (options.ownerInfo ?? null) : ownerInfo.value
          resolve(response.owned)
        })
    })
  }

  const release = (releaseOptions?: { changed?: boolean, meta?: unknown }): Promise<void> => {
    if (!socket) return Promise.resolve()
    return new Promise((resolve) => {
      socket
        .timeout(ACK_TIMEOUT)
        .emit('lock:release', { key, changed: releaseOptions?.changed ?? false, meta: releaseOptions?.meta }, (err: Error, response: LockReleaseResponse) => {
          if (err || !response?.success) {
            logger?.error('Failed to release lock:', err || response?.error)
          }
          else {
            locked.value = false
            ownedByMe.value = false
            ownerInfo.value = null
          }
          resolve()
        })
    })
  }

  const forceRelease = (): Promise<boolean> => {
    if (!socket) return Promise.resolve(false)
    return new Promise((resolve) => {
      socket
        .timeout(ACK_TIMEOUT)
        .emit('lock:forceRelease', { key }, (err: Error, response: LockForceReleaseResponse) => {
          if (err || !response?.success) {
            logger?.error('Failed to force-release lock:', err || response?.error)
            resolve(false)
            return
          }
          locked.value = false
          ownedByMe.value = false
          ownerInfo.value = null
          resolve(true)
        })
    })
  }

  onUnmounted(() => {
    if (!socket) return
    socket.off('lock:changed', handleLockChanged)
    socket.off('connect', subscribe)
    socket.emit('lock:unsubscribe', key)
    // Best-effort: don't block unmount on a server round-trip
    if (ownedByMe.value) {
      socket.emit('lock:release', { key, changed: false }, () => {})
    }
  })

  return {
    claim,
    release,
    forceRelease,
    ownedByMe: readonly(ownedByMe),
    locked: readonly(locked),
    ownerInfo: readonly(ownerInfo) as Readonly<Ref<TOwnerInfo | null>>,
  }
}
