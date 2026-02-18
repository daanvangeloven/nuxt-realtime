---
seo:
  title: Nuxt Realtime
  description: Real-time state synchronization for Nuxt applications using Socket.IO.
---

::u-page-hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}
---
orientation: horizontal
---
#top
:hero-background

#title
Build [Realtime]{.text-primary} Experiences.

#description
Real-time state synchronization for Nuxt applications. Share reactive state across clients, broadcast events, and manage connections with a developer-friendly API.

#links

  :::u-button
  ---
  to: /getting-started
  size: xl
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :::u-button
  ---
  to: https://github.com/daanvangeloven/nuxt-realtime
  target: _blank
  size: xl
  variant: outline
  trailing-icon: i-simple-icons-github
  ---
  View on GitHub
  :::

#default
  :::prose-pre
  ---
  filename: example.vue
  ---

  ```vue
  <script setup lang="ts">
  // Shared state that is synced across all clients
  const counter = useRealtimeState('counter', 0)

  // Broadcast events to other clients
  const { publish } = useRealtimeEvents()
  </script>

  <template>
    <button @click="counter++">
      Count: {{ counter }}
    </button>
  </template>
  ```
  :::
::

::u-page-section{class="dark:bg-neutral-950"}
#title
Simple, Powerful Composables

#features
  :::u-page-feature
  ---
  icon: i-lucide-refresh-cw
  ---
  #title
  Realtime State

  #description
  Share reactive state across all connected clients. **Works just like Vue's useState**, update the value and it syncs everywhere automatically.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-radio
  ---
  #title
  Realtime events

  #description
  Publish and subscribe to events across clients. Perfect for notifications, chat messages, or any real-time communication.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-wifi
  ---
  #title
  Realtime Connection

  #description
  Monitor connection status with reactive state. Handle connect, disconnect, and reconnection events with callbacks.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-plug
  ---
  #title
  Built on Socket.IO

  #description
  Reliable WebSocket connections with automatic reconnection, fallbacks to polling, and battle-tested performance.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-zap
  ---
  #title
  Optimistic Updates

  #description
  Instant UI feedback with automatic rollback on failure. Configure per-state for the best user experience.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-database
  ---
  #title
  Pluggable Storage

  #description
  Use memory, Redis, or any Nitro-supported storage driver for state persistence. Scale horizontally with shared storage backends.
  :::
::

::u-page-section{class="dark:bg-gradient-to-b from-neutral-950 to-neutral-900"}
  :::u-page-c-t-a
  ---
  links:
    - label: Get Started
      to: '/getting-started'
      trailingIcon: i-lucide-arrow-right
    - label: View on GitHub
      to: 'https://github.com/daanvangeloven/nuxt-realtime'
      target: _blank
      variant: subtle
      icon: i-simple-icons-github
  title: Ready to build realtime applications?
  description: Add real-time features to your Nuxt app in minutes.
  class: dark:bg-neutral-950
  ---

  :stars-bg
  :::
::
