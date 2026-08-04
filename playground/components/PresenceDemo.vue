<script setup lang="ts">
const name = ref(`Guest-${Math.floor(Math.random() * 1000)}`)
const { members, join, leave } = useRealtimePresence('playground:presence-demo', {
  info: { name: name.value },
})
</script>

<template>
  <div class="border rounded-lg p-4">
    <h2 class="text-lg font-bold mb-4">
      Presence Demo
    </h2>
    <p class="text-gray-500 text-sm mb-4">
      Open this page in multiple tabs to see who else is here. You're joined as
      <span class="font-bold">{{ name }}</span>. Uses useRealtimePresence.
    </p>

    <div class="flex gap-2 mb-4">
      <UButton @click="join">
        Join
      </UButton>
      <UButton
        color="neutral"
        @click="leave"
      >
        Leave
      </UButton>
    </div>

    <div class="flex flex-wrap gap-2">
      <UBadge
        v-for="(info, id) in members"
        :key="id"
      >
        {{ info?.name ?? id }}
      </UBadge>
      <span
        v-if="Object.keys(members).length === 0"
        class="text-gray-400 text-sm"
      >
        Nobody here yet
      </span>
    </div>
  </div>
</template>
