---
title: Nuxt Realtime 0.2.1
description: Security hardening for the realtime server, including origin checks, reconnect secrets, per-connection limits and authorization hooks.
date: 2026-10-26
category: Release
tags: [release, security]
authors:
  - name: Daan van Geloven
    avatar:
      src: https://github.com/daanvangeloven.png
    to: https://github.com/daanvangeloven
---

Nuxt Realtime 0.2.1 is a security release. We recommend everyone upgrade.

## Origin check

The realtime server now rejects cross-site WebSocket connections. Without `cors.origin`, only same-origin connections are accepted (`X-Forwarded-Host` is honored behind a proxy). With it set, only the listed origins get in. Clients that send no `Origin` header, such as server-side or native clients, are still accepted.

::callout{color="warning"}
If your Nuxt app and realtime server run on different origins (for example a standalone server behind `socketio.serverUrl`), set `cors.origin` to your app's origin. The module logs a warning when `serverUrl` is set without it.
::

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  nuxtRealtime: {
    socketio: {
      serverUrl: 'https://realtime.example.com',
      serverOptions: { cors: { origin: ['https://app.example.com'] } },
    },
  },
})
```

See [origin check](/getting-started/configuration#origin-check).

## Reconnect identity

A `connectionId` is visible to other clients, because it is the owner shown on locks and presence. It was never a credential, but it was treated like one. The server now issues a per-connection secret and only lets a client reclaim an id by presenting it, so nobody can take over another client's locks, presence or room membership. A client that loses its secret reconnects with a fresh identity.

See [reconnect identity](/getting-started/authentication#reconnect-identity).

## Limits

Each connection is now capped so a single client cannot exhaust server memory or storage. The defaults can be raised or lowered:

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  nuxtRealtime: {
    limits: {
      maxKeyLength: 256,
      maxValueBytes: 262_144,
      maxKeysPerSocket: 1000,
      maxEventsPerSecond: 120,
    },
  },
})
```

## Authorizing subscriptions and publishes

Any client could subscribe to any event channel or lock. Two new Nitro hooks let you restrict that. Both allow by default, and a hook that throws denies:

```ts [server/plugins/realtime-auth.ts]
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('nuxt-realtime:canSubscribe', (ctx) => {
    if (ctx.kind === 'event') ctx.allow = !ctx.name.startsWith('admin:') && ctx.name !== '*'
  })
  nitroApp.hooks.hook('nuxt-realtime:canPublish', (ctx) => {
    ctx.allow = ctx.channel.startsWith('chat:')
  })
})
```

See [authorizing subscriptions and publishes](/getting-started/configuration#authorizing-subscriptions-and-publishes).

## Also in this release

- Input validation on storage, lock, presence, room and event payloads.
- Dependency updates for security fixes.
- Node.js is locked to 24.

The full list is in the [changelog](https://github.com/daanvangeloven/nuxt-realtime/blob/master/CHANGELOG.md).
