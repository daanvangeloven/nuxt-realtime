import { ref, computed, onUnmounted, toValue, readonly, type MaybeRefOrGetter, type ComputedRef, type Ref } from 'vue'
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

  /**
   * Whether to immediately fetch the initial value from the server
   *
   * @default true
   */
  immediate?: boolean
}

export interface UseRealtimeStateReturn<T> {
  /**
   * The reactive state value
   */
  value: ComputedRef<T>
  /**
   * Loading state - true while fetching initial value
   */
  loading: Readonly<Ref<boolean>>
  /**
   * Manually refresh the value from the server
   */
  refresh: () => void
}

export function useRealtimeState<T>(key: MaybeRefOrGetter<string>, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T>
export function useRealtimeState<T>(key: MaybeRefOrGetter<string>, defaultValue: T, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T>

export function useRealtimeState<T>(key: MaybeRefOrGetter<string>, defaultValue?: T, options?: useRealtimeStateOptions): UseRealtimeStateReturn<T> {
  const { $realtimeSocket } = useNuxtApp()
  const _value = ref<T>(defaultValue as T)
  const loading = ref(true)

  const {
    optimisticUpdates = true,
    updateTimeout = 5000,
    immediate = true,
  } = options ?? {}

  const value = computed({
    get: () => _value.value,
    set: (newValue: T) => {
      const oldValue = _value.value
      // Optimistically update the value
      if (optimisticUpdates) {
        _value.value = newValue
      }

      $realtimeSocket
        .timeout(updateTimeout)
        .emit('storage:set', { key: toValue(key), value: newValue },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err: any, response: any) => {
            // Revert on timeout or server error
            if (err || !response?.success) {
              console.error('Failed to update storage:', err || response?.error)
              _value.value = oldValue
            }
          })
    },
  })

  // Get initial value
  if (immediate) {
    $realtimeSocket
      .timeout(updateTimeout)
      .emit('storage:get', toValue(key),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any, serverValue?: T) => {
          if (err) {
            console.error('Failed to fetch initial storage value:', err)
          }
          else if (serverValue !== null && serverValue !== undefined) {
            _value.value = serverValue
          }
          loading.value = false
        })
  }
  else {
    loading.value = false
  }

  // Subscribe to this key
  $realtimeSocket.emit('storage:subscribe', toValue(key))

  // Listen for updates from server
  // TODO: fix typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdate = ({ key: updatedKey, value: newValue }: any) => {
    if (updatedKey === toValue(key)) {
      // Update internal value directly - doesn't trigger setter
      _value.value = newValue
    }
  }
  $realtimeSocket.on('storage:updated', handleUpdate)

  // Refresh function to manually fetch latest value from server
  const refresh = () => {
    loading.value = true
    $realtimeSocket
      .timeout(updateTimeout)
      .emit('storage:get', toValue(key),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any, serverValue?: T) => {
          if (err) {
            console.error('Failed to fetch storage value:', err)
          }
          else if (serverValue !== null && serverValue !== undefined) {
            _value.value = serverValue
          }
          loading.value = false
        })
  }

  // Cleanup
  onUnmounted(() => {
    $realtimeSocket.emit('storage:unsubscribe', toValue(key))
    $realtimeSocket.off('storage:updated', handleUpdate)
  })

  return {
    value,
    loading: readonly(loading),
    refresh,
  }
}
