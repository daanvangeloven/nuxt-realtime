# Nuxt Realtime

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Drop-in realtime state sync for Nuxt. Implement `useRealtimeState()` and it works across all connected clients.

> **Public Beta**
> The API is stable but the module is actively evolving. Early adopters welcome, feedback and contributions are very appreciated!

## Features

- Real-time state synchronization across all connected clients
- Channel-based subscriptions for granular updates
- Built on Socket.IO for reliable WebSocket connections
- Works just like `useState`: no store setup, no manual socket handling
- Auth hooks for socket middleware
- Zero boilerplate

## Quick Setup

[Full documentation](https://nuxtrealtime.com)

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-realtime
```

## Implementation Guide

### Basic Usage

1. **Configure the module** in your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-realtime'],
  realtime: {
    // Configuration options will be added here
  }
})
```

2. **Use the composable** in your components:

```vue
<script setup>
// Works just like useState
const data = useRealtimeState('my-key', {
  count: 0,
  message: 'Hello'
})

// Update state (automatically broadcast to all connected clients)
data.value.count++
data.value.message = 'Updated!'
</script>

<template>
  <div>
    <p>Count: {{ data.count }}</p>
    <p>Message: {{ data.message }}</p>
    <button @click="data.count++">Increment</button>
  </div>
</template>
```

### Key Concepts

- **Simple API**: Works just like Vue's `useState`
- **Automatic Sync**: The plugin handles all subscription and broadcasting automatically
- **Keyed State**: Each key maintains its own isolated state
- **Reactivity**: State is reactive and works seamlessly with Vue's reactivity system

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
