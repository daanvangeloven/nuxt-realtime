<script setup>
const counter = useRealtimeState('counter', 0, {
  optimisticUpdates: true,
})
</script>

<template>
  <UApp>
    <div class="p-4">
      <ConnectionStatus />
      <div class="w-30 border my-4 px-10 py-5 flex gap-4 items-center">
        <h1 class="text-lg">
          Counter: <span class="font-bold">{{ counter }}</span>
        </h1>
        <button
          class="border px-4 py-2"
          @click="counter++"
        >
          +
        </button>
      </div>

      <SyncStrategiesDemo class="my-4" />

      <EventsDemo class="my-4" />

      <PresenceDemo class="my-4" />

      <PresenceAvatarDemo class="my-4" />

      <LockDemo class="my-4" />

      <RoomDemo class="my-4" />

      <Chatfeed />
    </div>
  </UApp>
</template>
