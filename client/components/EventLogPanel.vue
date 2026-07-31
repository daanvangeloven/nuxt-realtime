<script setup lang="ts">
import { useEventTypeFilter } from '../composables/useEventTypeFilter'
import { formatTime } from '../utils/format'
import { EVENT_TYPES } from '../types'
import type { DevtoolsEventLogEntry } from '../types'

const props = defineProps<{
  events: DevtoolsEventLogEntry[]
}>()

const events = computed(() => props.events)
const { activeTypes, filteredEvents, isAllActive, setAll, toggle } = useEventTypeFilter(events)
</script>

<template>
  <NSectionBlock
    text="Event log"
    icon="i-carbon-list-boxes"
  >
    <div class="flex justify-end mb-2">
      <NDropdown direction="end">
        <template #trigger="{ click }">
          <NButton n="xs" @click="click">
            Filter events ({{ activeTypes.length }}/{{ EVENT_TYPES.length }})
          </NButton>
        </template>
        <div class="p-2 flex flex-col gap-1 whitespace-nowrap">
          <NCheckbox
            :model-value="isAllActive"
            class="text-xs font-mono border-b n-border-base pb-1 mb-1"
            @update:model-value="setAll(Boolean($event))"
          >
            All
          </NCheckbox>
          <NCheckbox
            v-for="t in EVENT_TYPES"
            :key="t"
            :model-value="activeTypes.includes(t)"
            class="text-xs font-mono"
            @update:model-value="toggle(t, Boolean($event))"
          >
            {{ t }}
          </NCheckbox>
        </div>
      </NDropdown>
    </div>
    <div class="max-h-60 overflow-y-auto flex flex-col-reverse">
      <div
        v-for="e in filteredEvents"
        :key="e.id"
        class="flex items-center gap-2 px-2 py-1 text-xs hover:bg-hover rounded"
      >
        <span class="op-40 min-w-16">{{ formatTime(e.timestamp) }}</span>
        <span class="font-semibold min-w-32">{{ e.type }}</span>
        <span class="font-mono op-60 min-w-24 truncate">{{ e.socketId }}</span>
        <span
          v-if="e.detail"
          class="op-60 truncate"
        >{{ e.detail }}</span>
      </div>
    </div>
    <div
      v-if="props.events.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No events yet
    </div>
    <div
      v-else-if="filteredEvents.length === 0"
      class="px-2 py-4 text-sm op-40 italic"
    >
      No events match the selected filters
    </div>
  </NSectionBlock>
</template>
