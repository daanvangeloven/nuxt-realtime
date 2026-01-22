<script setup lang="ts">
const { connected, status, attempt } = useRealtimeConnection({
  onConnected: () => console.log('Connected'),
  onDisconnected: reason => console.log('Disconnected:', reason),
  onReconnecting: attempt => console.log('Reconnecting, attempt:', attempt),
  onReconnected: attempt => console.log('Reconnected after', attempt, 'attempts'),
  onReconnectFailed: () => console.log('Reconnect failed'),
  onError: error => console.error('Connection error:', error),
})

const statusColor = computed(() => {
  switch (status.value) {
    case 'connected': return 'text-green-600'
    case 'disconnected': return 'text-red-600'
    case 'connecting':
    case 'reconnecting': return 'text-orange-500'
    default: return 'text-gray-600'
  }
})
</script>

<template>
  <div class="p-4 border border-gray-300 rounded-lg font-mono mb-4">
    <div class="flex gap-2 mb-1">
      <span class="text-gray-500">Status:</span>
      <span
        class="font-bold"
        :class="statusColor"
      >{{ status }}</span>
    </div>
    <div class="flex gap-2 mb-1">
      <span class="text-gray-500">Connected:</span>
      <span
        class="font-bold"
        :class="connected ? 'text-green-600' : 'text-red-600'"
      >{{ connected }}</span>
    </div>
    <div
      v-if="attempt !== undefined"
      class="flex gap-2"
    >
      <span class="text-gray-500">Attempt:</span>
      <span class="font-bold">{{ attempt }}</span>
    </div>
  </div>
</template>
