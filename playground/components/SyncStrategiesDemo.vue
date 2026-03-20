<script setup lang="ts">
const immediate = useRealtimeState('sync-demo:immediate', '', {
  sync: 'immediate',
})

const debounced = useRealtimeState('sync-demo:debounced', '', {
  sync: 'debounced',
  debounceMs: 500,
})
const debouncedIsDirty = debounced.isDirty

const manual = useRealtimeState('sync-demo:manual', '', {
  sync: 'manual',
})
const manualSync = manual.sync
const manualIsDirty = manual.isDirty
</script>

<template>
  <div class="border rounded-lg p-4">
    <h2 class="text-lg font-bold mb-4">
      Sync Strategies Demo
    </h2>
    <p class="text-gray-500 text-sm mb-4">
      Type in each input to see how the different sync strategies behave. Open this page in multiple tabs to observe the syncing.
    </p>

    <div class="flex flex-col gap-6">
      <!-- Immediate -->
      <div>
        <label class="block text-sm font-medium mb-1">
          Immediate <span class="text-gray-400 font-normal">(syncs on every keystroke)</span>
        </label>
        <UInput
          v-model="immediate"
          placeholder="Type something..."
          class="w-full"
        />
      </div>

      <!-- Debounced -->
      <div>
        <label class="block text-sm font-medium mb-1">
          Debounced 500ms
          <span class="text-gray-400 font-normal">(syncs 500ms after you stop typing)</span>
          <UBadge
            v-if="debouncedIsDirty"
            color="warning"
            variant="subtle"
            class="ml-2"
          >
            pending
          </UBadge>
        </label>
        <UInput
          v-model="debounced"
          placeholder="Type something..."
          class="w-full"
        />
      </div>

      <!-- Manual -->
      <div>
        <label class="block text-sm font-medium mb-1">
          Manual
          <span class="text-gray-400 font-normal">(only syncs when you click Save)</span>
          <UBadge
            v-if="manualIsDirty"
            color="warning"
            variant="subtle"
            class="ml-2"
          >
            unsaved changes
          </UBadge>
        </label>
        <div class="flex gap-2">
          <UInput
            v-model="manual"
            placeholder="Type something..."
            class="flex-1"
          />
          <UButton
            :disabled="!manualIsDirty"
            @click="manualSync"
          >
            Save
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
