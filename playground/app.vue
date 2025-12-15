<script setup>
const counter = useRealtimeState('counter', 0, {
  optimisticUpdates: true,
})
</script>

<template>
  <div>
    <h1>{{ counter }}</h1>
    <button @click="counter++">
      +
    </button>
  </div>
</template>
