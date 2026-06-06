import { ref, computed, onUnmounted, readonly, type Ref, type WritableComputedRef } from 'vue'
import { useNuxtApp } from '#app'
import type { StorageSetResponse, StorageUpdatePayload } from '../types'
import { useRealtimeLogger } from './useRealtimeLogger'

export type SyncStrategy = 'immediate' | 'debounced' | 'manual'

export interface useRealtimeStateOptions {
  /**
   * Whether to optimistically update the value on update.
   * Only applies to `immediate` and `debounced` strategies.
   *
   * @default true
   */
  optimisticUpdates?: boolean

  /**
   * The timeout for value updates
   *
   * @default 5000
   */
  updateTimeout?: number

  /**
   * Sync strategy:
   * - `immediate` (default): every state change syncs to server immediately
   * - `debounced`: buffers rapid changes and syncs after `debounceMs` delay
   * - `manual`: local-only updates until `sync()` is called explicitly
   *
   * @default 'immediate'
   */
  sync?: SyncStrategy

  /**
   * Debounce delay in milliseconds. Only applies when `sync` is `'debounced'`.
   *
   * @default 300
   */
  debounceMs?: number
}

export interface UseRealtimeStateReturn<T> extends WritableComputedRef<T> {
  /**
   * Loading state - true while fetching initial value
   */
  loading: Readonly<Ref<boolean>>

  /**
   * Manually refresh the value from the server
   */
  refresh: () => void

  /**
   * Whether there are local changes not yet synced to the server.
   * Only meaningful when `sync` strategy is `'manual'`.
   */
  isDirty: Readonly<Ref<boolean>>

  /**
   * Explicitly push the current local value to the server.
   * Primarily used with the `'manual'` sync strategy, but callable on any strategy.
   */
  sync: () => void
}

export function useRealtimeState<T>(key: string, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T>
export function useRealtimeState<T>(key: string, defaultValue: T, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T>
export function useRealtimeState<T>(key: string, defaultValue?: T, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T> {
  const socket = import.meta.client ? useNuxtApp().$realtimeSocket : null
  const logger = import.meta.client ? useRealtimeLogger() : null

  const _value = ref<T>(defaultValue as T)
  const loading = ref(import.meta.client)
  const isDirty = ref(false)

  const {
    optimisticUpdates = true,
    updateTimeout = 5000,
    sync: syncStrategy = 'immediate',
    debounceMs = 300,
  } = options ?? {}

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Pending value queued while disconnected, flushed on reconnect
  let pendingSync: { value: T, active: boolean } = { value: undefined as T, active: false }

  const pushToServer = (newValue: T, oldValue: T) => {
    if (!socket) return

    if (!socket.connected) {
      pendingSync = { value: newValue, active: true }
      return
    }

    socket
      .timeout(updateTimeout)
      .emit('storage:set', { key, value: newValue },
        (err: Error, response: StorageSetResponse) => {
          if (err || !response?.success) {
            logger?.error('Failed to update storage:', err || response?.error)
            if (syncStrategy !== 'manual') {
              _value.value = oldValue
            }
          }
          else {
            pendingSync.active = false
            if (syncStrategy === 'manual') {
              isDirty.value = false
            }
          }
        })
  }

  const value = computed({
    get: () => _value.value,
    set: (newValue: T) => {
      if (!socket) return

      if (syncStrategy === 'manual') {
        _value.value = newValue
        isDirty.value = true
        return
      }

      const oldValue = _value.value

      if (optimisticUpdates) {
        _value.value = newValue
      }

      if (syncStrategy === 'debounced') {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer)
        }
        debounceTimer = setTimeout(() => {
          pushToServer(newValue, oldValue)
          debounceTimer = null
        }, debounceMs)
      }
      else {
        pushToServer(newValue, oldValue)
      }
    },
  })

  // Explicitly push current local value to server
  const sync = () => {
    if (!socket) return
    const currentValue = _value.value
    pushToServer(currentValue, currentValue)
  }

  // Update handler
  const handleUpdate = ({ key: updatedKey, value: newValue }: StorageUpdatePayload) => {
    if (updatedKey === key) {
      _value.value = newValue as T
      if (syncStrategy === 'manual') {
        isDirty.value = false
      }
    }
  }

  // On reconnect: re-subscribe, re-fetch, and flush any pending sync
  const handleReconnect = () => {
    socket!.emit('storage:subscribe', key)
    socket!
      .timeout(updateTimeout)
      .emit('storage:get', key,
        (err: Error, serverValue: unknown) => {
          if (!err && serverValue !== null && serverValue !== undefined) {
            _value.value = serverValue as T
          }
          if (pendingSync.active) {
            pushToServer(pendingSync.value, _value.value)
          }
        })
  }

  // Fetch initial value and subscribe to updates
  if (socket) {
    socket
      .timeout(updateTimeout)
      .emit('storage:get', key,
        (err: Error, serverValue: unknown) => {
          if (err) {
            logger?.error('Failed to fetch initial storage value:', err)
          }
          else if (serverValue !== null && serverValue !== undefined) {
            _value.value = serverValue as T
          }
          loading.value = false

          socket.emit('storage:subscribe', key)
          socket.on('storage:updated', handleUpdate)
        })

    socket.on('connect', handleReconnect)
  }

  // Refresh function to manually fetch latest value from server
  const refresh = () => {
    if (!socket) return
    loading.value = true
    socket
      .timeout(updateTimeout)
      .emit('storage:get', key,
        (err: Error, serverValue: unknown) => {
          if (err) {
            logger?.error('Failed to fetch storage value:', err)
          }
          else if (serverValue !== null && serverValue !== undefined) {
            _value.value = serverValue as T
          }
          loading.value = false
        })
  }

  // Cleanup
  onUnmounted(() => {
    if (!socket) return
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    socket.emit('storage:unsubscribe', key)
    socket.off('storage:updated', handleUpdate)
    socket.off('connect', handleReconnect)
  })

  Object.assign(value, {
    loading: readonly(loading),
    refresh,
    isDirty: readonly(isDirty),
    sync,
  })

  return value as UseRealtimeStateReturn<T>
}
