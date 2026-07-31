<script setup lang="ts">
import { formatTime } from '../utils/format'
import type { ConnectionSummary } from '../types'

defineProps<{
  connection: ConnectionSummary
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <NNavbar>
    <template #actions>
      <div class="flex justify-between items-center w-full py-2 px-2">
        <div class="font-mono text-sm truncate">
          {{ connection.id }}
        </div>
        <NButton
          n="red"
          icon="i-carbon-close-large"
          @click="emit('close')"
        />
      </div>
    </template>
  </NNavbar>

  <div class="p-4">
    <NSectionBlock
      text="Connection"
      icon="i-carbon-information"
      container-class="font-mono text-xs"
    >
      <div class="flex items-center gap-2">
        <div class="op-60">
          address:
        </div>
        <div>
          {{ connection.address }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="op-60">
          transport:
        </div>
        <div>
          {{ connection.transport }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="op-60">
          connected:
        </div>
        <div>
          {{ formatTime(connection.connectedAt) }}
        </div>
      </div>
    </NSectionBlock>

    <NSectionBlock
      text="Channels"
      icon="i-carbon-chat"
    >
      <div class="flex flex-wrap gap-1">
        <NBadge
          v-for="ch in connection.channels"
          :key="ch"
        >
          {{ ch }}
        </NBadge>
        <span
          v-if="connection.channels.length === 0"
          class="text-xs op-40 italic"
        >
          none
        </span>
      </div>
    </NSectionBlock>

    <NSectionBlock
      text="Storage keys"
      icon="i-carbon-data-base"
    >
      <div class="flex flex-wrap gap-1">
        <NBadge
          v-for="key in connection.storageKeys"
          :key="key"
        >
          {{ key }}
        </NBadge>
        <span
          v-if="connection.storageKeys.length === 0"
          class="text-xs op-40 italic"
        >
          none
        </span>
      </div>
    </NSectionBlock>
  </div>
</template>
