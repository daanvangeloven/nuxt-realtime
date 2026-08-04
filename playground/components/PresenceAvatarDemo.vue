<script setup lang="ts">
const ROOM = 'playground:presence-avatar-demo'
const name = 'Ada Lovelace'
const { connectionId } = useRealtimeConnection()
useRealtimePresence(ROOM, { info: { name } })

const unstyled = ref(false)
</script>

<template>
  <div class="border rounded-lg p-4">
    <h2 class="text-lg font-bold mb-4">
      Presence Avatar Demo
    </h2>

    <div
      v-if="connectionId"
      class="flex items-center gap-6 mb-4"
    >
      <div class="flex flex-col items-center gap-2">
        <RealtimePresenceAvatar
          :room="ROOM"
          :connection-id="connectionId"
          :unstyled="unstyled"
        />
        <span class="text-xs text-gray-400">RealtimePresenceAvatar</span>
      </div>
    </div>
    <p
      v-else
      class="text-gray-400 text-sm mb-4"
    >
      Waiting for connection...
    </p>

    <UButton
      size="sm"
      color="neutral"
      @click="() => { unstyled = !unstyled }"
    >
      Toggle unstyled ({{ unstyled }})
    </UButton>
  </div>
</template>
