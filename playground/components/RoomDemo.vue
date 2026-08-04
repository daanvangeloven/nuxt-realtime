<script setup lang="ts">
const name = ref(`Guest-${Math.floor(Math.random() * 1000)}`)
const room = useRealtimeRoom('playground:room-demo')

const { members } = room.presence({ info: { name: name.value } })
const notes = room.state('notes', '')
const { claim, release, locked, ownedByMe, ownerInfo } = room.lock('notes-edit', {
  ownerInfo: { name: name.value },
})
const { locks } = room.locks()
</script>

<template>
  <div class="border rounded-lg p-4">
    <h2 class="text-lg font-bold mb-4">
      Room Demo
    </h2>
    <p class="text-gray-500 text-sm mb-4">
      Combines state, presence, and locking under one room via useRealtimeRoom. You're joined as
      <span class="font-bold">{{ name }}</span>. Open this page in multiple tabs to see it sync.
    </p>

    <div class="flex items-center gap-2 mb-4">
      <span class="text-sm text-gray-500">Present:</span>
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

    <UBadge
      v-if="locked && !ownedByMe"
      color="warning"
      variant="subtle"
      class="mb-2"
    >
      Notes locked by {{ ownerInfo?.name }}
    </UBadge>

    <div class="flex gap-2 mb-4">
      <UTextarea
        v-model="notes"
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

    <div class="text-sm text-gray-500">
      Locks in this room:
      {{ Object.keys(locks).length === 0 ? 'none' : Object.keys(locks).join(', ') }}
    </div>
  </div>
</template>
