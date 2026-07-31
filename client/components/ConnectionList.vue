<script setup lang="ts">
import { filterConnections } from '../utils/connections'
import { formatTime } from '../utils/format'
import type { ConnectionSummary } from '../types'

const props = defineProps<{
  connections: ConnectionSummary[]
  search: string
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const filtered = computed(() => filterConnections(props.connections, props.search))
</script>

<template>
  <NSectionBlock
    text="Connections"
    icon="i-carbon-connection-signal"
  >
    <div
      v-for="conn in filtered"
      :key="conn.id"
      class="flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-hover"
      :class="{ 'bg-active!': conn.id === selectedId }"
      @click="emit('select', conn.id)"
    >
      <div class="min-w-0">
        <div class="font-mono text-xs truncate">
          {{ conn.id }}
        </div>
        <div class="text-xs op-50">
          {{ conn.address }} · {{ conn.transport }} · since {{ formatTime(conn.connectedAt) }}
        </div>
      </div>
      <NBadge>{{ conn.channels.length }} ch</NBadge>
    </div>
    <div
      v-if="filtered.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No active connections
    </div>
  </NSectionBlock>
</template>
