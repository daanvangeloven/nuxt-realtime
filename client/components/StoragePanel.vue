<script setup lang="ts">
import type { StorageSnapshotEntry } from '../types'

defineProps<{
  entries: StorageSnapshotEntry[]
}>()
</script>

<template>
  <NSectionBlock
    text="Storage"
    icon="i-carbon-data-base"
  >
    <div
      v-for="entry in entries"
      :key="entry.key"
      class="flex items-center gap-2 px-2 py-1.5 font-mono text-xs"
    >
      <span class="truncate flex-1">{{ entry.key }}</span>
      <span class="op-50 truncate flex-1">{{ JSON.stringify(entry.value) }}</span>
      <NBadge>{{ entry.subscriberCount }}</NBadge>
    </div>
    <div
      v-if="entries.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No storage keys
    </div>
  </NSectionBlock>
</template>
