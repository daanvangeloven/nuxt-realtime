import { ref, computed, onUnmounted } from 'vue'
import { useNuxtApp } from '#app'

export function useRealtimeStorage<T>(key: string, defaultValue?: T) {
  const { $realtimeSocket } = useNuxtApp()
  const internalValue = ref<T>(defaultValue as T)
  const loading = ref(true)

  const value = computed({
    get: () => internalValue.value,
    set: (newValue: T) => {
      internalValue.value = newValue
      $realtimeSocket.emit('storage:set', { key, value: newValue })
    },
  })

  // Get initial value
  $realtimeSocket.emit('storage:get', key, (serverValue: T) => {
    if (serverValue !== null && serverValue !== undefined) {
      internalValue.value = serverValue
    }
    loading.value = false
  })

  // Subscribe to this key
  $realtimeSocket.emit('storage:subscribe', key)

  // Listen for updates from server
  // TODO: fix typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdate = ({ key: updatedKey, value: newValue }: any) => {
    if (updatedKey === key) {
      // Update internal value directly - doesn't trigger setter
      internalValue.value = newValue
    }
  }
  $realtimeSocket.on('storage:updated', handleUpdate)

  // Cleanup
  onUnmounted(() => {
    $realtimeSocket.emit('storage:unsubscribe', key)
    $realtimeSocket.off('storage:updated', handleUpdate)
  })

  return value
}
