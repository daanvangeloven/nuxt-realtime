<script setup lang="ts">
import { formatTime } from '../utils/format'
import type { LockSnapshotEntry } from '../types'

defineProps<{
  entries: LockSnapshotEntry[]
}>()
</script>

<template>
  <NSectionBlock
    text="Locks"
    icon="i-carbon-locked"
  >
    <div
      v-for="entry in entries"
      :key="entry.key"
      class="flex items-center gap-2 px-2 py-1.5 font-mono text-xs"
    >
      <span class="truncate flex-1">{{ entry.key }}</span>
      <span class="op-50 truncate flex-1">{{ entry.owner }}</span>
      <NBadge v-if="entry.room">
        {{ entry.room }}
      </NBadge>
      <span class="op-40">{{ entry.expiresAt ? formatTime(entry.expiresAt) : 'never' }}</span>
    </div>
    <div
      v-if="entries.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No locks held
    </div>
  </NSectionBlock>
</template>
