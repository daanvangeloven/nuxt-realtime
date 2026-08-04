<script setup lang="ts">
import type { RoomMembershipEntry } from '../types'

defineProps<{
  entries: RoomMembershipEntry[]
}>()
</script>

<template>
  <NSectionBlock
    text="Rooms"
    icon="i-carbon-group"
  >
    <div
      v-for="(entry, i) in entries"
      :key="`${entry.roomId}:${entry.connectionId}:${i}`"
      class="flex items-center gap-2 px-2 py-1.5 font-mono text-xs"
    >
      <NBadge>{{ entry.roomId }}</NBadge>
      <span class="truncate flex-1">{{ entry.connectionId }}</span>
    </div>
    <div
      v-if="entries.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No room members
    </div>
  </NSectionBlock>
</template>
