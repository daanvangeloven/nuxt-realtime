import { ref, computed, onUnmounted, readonly, type Ref, type WritableComputedRef } from 'vue'
import type { StorageSetResponse, StorageUpdatePayload } from '../types'
import { useNuxtApp } from '#app'

export interface useRealtimeStateOptions {
  /**
   * Whether to optimistically update the value on update
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
}

export function useRealtimeState<T>(key: string, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T>
export function useRealtimeState<T>(key: string, defaultValue: T, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T>

export function useRealtimeState<T>(key: string, defaultValue?: T, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T> {
  const socket = import.meta.client ? useNuxtApp().$realtimeSocket : null
  const _value = ref<T>(defaultValue as T)
  const loading = ref(import.meta.client)

  const {
    optimisticUpdates = true,
    updateTimeout = 5000,
  } = options ?? {}

  const value = computed({
    get: () => _value.value,
    set: (newValue: T) => {
      if (!socket) return
      const oldValue = _value.value

      // Optimistically update the value
      if (optimisticUpdates) {
        _value.value = newValue
      }

      socket
        .timeout(updateTimeout)
        .emit('storage:set', { key, value: newValue },
          (err: Error, response: StorageSetResponse) => {
            // Revert on timeout or server error
            if (err || !response?.success) {
              console.error('Failed to update storage:', err || response?.error)
              _value.value = oldValue
            }
          })
    },
  })

  // Update handler
  const handleUpdate = ({ key: updatedKey, value: newValue }: StorageUpdatePayload) => {
    if (updatedKey === key) {
      // Update internal value directly to prevent setter loop
      _value.value = newValue as T
    }
  }

  // Fetch initial value and subscribe to updates
  if (socket) {
    socket
      .timeout(updateTimeout)
      .emit('storage:get', key,
        (err: Error, serverValue: unknown) => {
          if (err) {
            console.error('Failed to fetch initial storage value:', err)
          }
          else if (serverValue !== null && serverValue !== undefined) {
            _value.value = serverValue as T
          }
          loading.value = false

          // Subscribe and listen
          socket.emit('storage:subscribe', key)
          socket.on('storage:updated', handleUpdate)
        })
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
            console.error('Failed to fetch storage value:', err)
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
    socket.emit('storage:unsubscribe', key)
    socket.off('storage:updated', handleUpdate)
  })

  // Attach loading and refresh as properties on the ref
  Object.assign(value, {
    loading: readonly(loading),
    refresh,
  })

  return value as UseRealtimeStateReturn<T>
}
