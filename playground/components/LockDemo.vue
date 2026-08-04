<script setup lang="ts">
const name = ref(`Guest-${Math.floor(Math.random() * 1000)}`)
const title = useRealtimeState('playground:lock-demo:title', 'Untitled document')
const { claim, release, locked, ownedByMe, ownerInfo } = useRealtimeLock('playground:lock-demo', {
  ownerInfo: { name: name.value },
})
</script>

<template>
  <div class="border rounded-lg p-4">
    <h2 class="text-lg font-bold mb-4">
      Lock Demo
    </h2>
    <p class="text-gray-500 text-sm mb-4">
      Only one client (you, as <span class="font-bold">{{ name }}</span>) can edit the title at a
      time. Open this page in multiple tabs to see the lock in action. Uses useRealtimeLock.
    </p>

    <UBadge
      v-if="locked && !ownedByMe"
      color="warning"
      variant="subtle"
      class="mb-2"
    >
      Locked by {{ ownerInfo?.name }}
    </UBadge>

    <div class="flex gap-2">
      <UInput
        v-model="title"
        :disabled="!ownedByMe"
        class="flex-1"
      />
      <UButton
        v-if="!ownedByMe"
        :disabled="locked"
        @click="claim()"
      >
        Edit
      </UButton>
      <UButton
        v-else
        color="neutral"
        @click="release({ changed: true })"
      >
        Done
      </UButton>
    </div>
  </div>
</template>
