# Nuxt Realtime

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Drop-in realtime state sync for Nuxt. Implement `useRealtimeState()` and it works across all connected clients.


## Features

- 🔄 &nbsp;Real-time state synchronization across all connected clients
- 📡 &nbsp;Event pub/sub with wildcard channel subscriptions
- 🎯 &nbsp;Three sync strategies: `immediate`, `debounced`, and `manual`
- 🔌 &nbsp;Built on Socket.IO for reliable WebSocket connections
- 🎨 &nbsp;Works just like `useState`
- 🔐 &nbsp;Auth hooks via a Nitro plugin
- 🏗️ &nbsp;Redis adapter for cross-server state sync in multi-instance deployments
- 🪶 &nbsp;Zero boilerplate

## Quick Setup

📖 [Full documentation](https://nuxtrealtime.com)

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-realtime
```

Then enable WebSockets in your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-realtime'],
  nitro: {
    experimental: { websocket: true },
  },
})
```

## Usage

### State sync

`useRealtimeState` works like `useState` but syncs across every connected client:

```vue
<script setup>
const counter = useRealtimeState('counter', 0)
</script>

<template>
  <div>
    <p>Count: {{ counter }}</p>
    <button @click="counter++">Increment</button>
  </div>
</template>
```

Every assignment to `counter.value` (or `counter++` in templates) is immediately broadcast to all other clients subscribed to the same key.

### Sync strategies

Control when local changes are pushed to the server:

```vue
<script setup>
// immediate  syncs on every change
const liveText = useRealtimeState('text:live', '')

// debounced buffers rapid changes, syncs after 500 ms of inactivity
const debouncedText = useRealtimeState('text:debounced', '', {
  sync: 'debounced',
  debounceMs: 500,
})

// manual local-only until sync() is called explicitly
const draftText = useRealtimeState('text:draft', '', { sync: 'manual' })
const isDirty = draftText.isDirty
const save = draftText.sync
</script>

<template>
  <input v-model="debouncedText" />

  <div>
    <input v-model="draftText" />
    <button :disabled="!isDirty" @click="save">Save</button>
  </div>
</template>
```

`useRealtimeState` also exposes `loading` (true while the initial value is being fetched from the server) and `refresh()` to manually re-fetch.

### Event pub/sub

`useRealtimeEvents` is a lightweight pub/sub layer on top of the WebSocket connection. Use it for one-way broadcasts that don't need shared state — notifications, cursor positions, presence, etc.

```vue
<script setup lang="ts">
interface ChatEvents {
  'chat:message': { userId: string; text: string }
  'chat:typing': { userId: string }
}

const { publish, subscribe } = useRealtimeEvents<ChatEvents>()

// Subscribe to a specific channel
subscribe('chat:message', (msg) => {
  console.log(msg.userId, msg.text)  // fully typed
})

// Wildcard channel fires for chat:message, chat:typing, chat:anything
subscribe('chat:*', (data, channel) => {
  console.log('received on', channel, data)
})

async function send(text: string) {
  await publish('chat:message', { userId: 'me', text })
}
</script>
```

Subscriptions are cleaned up automatically when the component unmounts.

You can also add middleware to intercept or transform events before subscribers receive them:

```ts
const { subscribe } = useRealtimeEvents({
  middleware: [
    (event, next) => {
      if (!isValid(event.data)) return  // block the event
      event.data = sanitize(event.data) // mutate the payload
      next()
    },
  ],
})
```

### Connection status

```vue
<script setup>
const { status, connected, connect, disconnect } = useRealtimeConnection({
  onReconnecting: (attempt) => console.log('reconnecting, attempt', attempt),
  onReconnected: () => console.log('back online'),
})
</script>

<template>
  <span>{{ status }}</span>  <!-- 'connected' | 'disconnected' | 'connecting' | 'reconnecting' -->
</template>
```

## Configuration

All options go under `nuxtRealtime` in your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-realtime'],
  nuxtRealtime: {
    // Redis for cross-server state sync (multi-instance deployments)
    redis: {
      host: 'localhost',
      port: 6379,
      // or: url: 'redis://localhost:6379'
    },

    // Custom Socket.IO server URL (defaults to same origin)
    socketio: {
      serverUrl: 'https://my-realtime-server.com',
      path: '/socket.io',
    },

    // Idle-key cleanup (defaults shown; set to false to disable)
    cleanup: {
      heartbeatInterval: 30_000,   // ms between client heartbeats
      cleanupInterval: 300_000,    // ms between server scans
      idleThreshold: 3_600_000,    // ms before an idle key is removed
    },

    // Logging
    logging: {
      level: 'warn',   // 'debug' | 'info' | 'warn' | 'error' | 'silent'
      format: 'json',  // 'pretty' (default) | 'json'
    },
  },
})
```

### Auth middleware

Register Socket.IO middleware in a Nitro server plugin to authenticate or authorize clients before any connection handler runs:

```typescript
// server/plugins/realtime-auth.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('nuxt-realtime:io', (io) => {
    io.use((socket, next) => {
      const token = socket.handshake.auth.token
      if (!verifyToken(token)) return next(new Error('Unauthorized'))
      next()
    })
  })
})
```

### Multi-server / Redis

When running multiple server instances, add the `redis` option so that state writes and event broadcasts reach clients connected to any instance:

```typescript
nuxtRealtime: {
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
},
```

`ioredis >= 5` must be installed as a peer dependency.

## Contribution

We welcome contributions! Please follow these guidelines when contributing to the project.


<details>
  <summary>Contribution guidelines</summary>


### Commit Message Format

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. All commit messages should be structured as follows:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

#### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries

#### Scopes

- **core**: Core functionality
- **types**: TypeScript type definitions
- **docs**: Documentation
- **deps**: Dependencies

#### Examples

```bash
feat(core): add support for custom socket.io configuration
fix(realtime): resolve subscription memory leak on unmount
docs(readme): update implementation guide with examples
chore(deps): upgrade socket.io to v4.6.0
```
</details>


<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-realtime/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-realtime

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-realtime.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/nuxt-realtime

[license-src]: https://img.shields.io/npm/l/nuxt-realtime.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-realtime

[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
