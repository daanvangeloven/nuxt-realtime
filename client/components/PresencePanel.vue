<script setup lang="ts">
import type { PresenceSnapshotEntry } from '../types'

defineProps<{
  entries: PresenceSnapshotEntry[]
}>()
</script>

<template>
  <NSectionBlock
    text="Presence"
    icon="i-carbon-user-multiple"
  >
    <div
      v-for="(entry, i) in entries"
      :key="`${entry.room}:${entry.connectionId}:${i}`"
      class="flex items-center gap-2 px-2 py-1.5 font-mono text-xs"
    >
      <NBadge>{{ entry.room }}</NBadge>
      <span class="truncate flex-1">{{ entry.connectionId }}</span>
      <span class="op-50 truncate flex-1">{{ JSON.stringify(entry.info) }}</span>
    </div>
    <div
      v-if="entries.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No presence
    </div>
  </NSectionBlock>
</template>
