<script setup lang="ts">
import { useRealtimeConnection } from '../composables/useRealtimeConnection'

const { connected } = useRealtimeConnection()
</script>

<template>
  <slot v-if="connected" />
  <slot
    v-else
    name="fallback"
  />
</template>
