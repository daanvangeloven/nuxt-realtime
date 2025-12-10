<script setup>
const counter = useRealtimeStorage('counter', 0)
</script>

<template>
  <div>
    <h1>{{ counter }}</h1>
    <button @click="counter++">
      +
    </button>
  </div>
</template>
