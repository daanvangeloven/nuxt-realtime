---
title: Nuxt Realtime 0.2
description: DevTools and connection auth land in Nuxt Realtime 0.2.
date: 2026-07-31
category: Release
tags: [release]
authors:
  - name: Daan van Geloven
    avatar:
      src: https://github.com/daanvangeloven.png
    to: https://github.com/daanvangeloven
---

Nuxt Realtime 0.2 is out. Here's what's new since the last release.

## Realtime DevTools

![image](/realtime-devtools.png)

A "Realtime" tab in [Nuxt DevTools](https://devtools.nuxt.com/) shows what's happening on the wire while you develop: active connections, subscribed channels and storage keys per socket, live storage values, and a scrolling event log. It's dev-only and never ships in production.

See the [DevTools docs](/getting-started/devtools) for details.

## Connection authentication

A new `nuxt-realtime:io` Nitro hook exposes the Socket.IO `Server` before any connections are accepted, so you can register `io.use()` middleware to authenticate or authorize clients — JWT, session cookies, or anything else. A matching `nuxt-realtime:auth` app hook lets the client attach a fresh token on every connection attempt, including reconnects.

See the [Authentication docs](/getting-started/authentication) for details.

## Redis Cluster support

The Redis driver now accepts a `cluster` option, so `reactiveRedisDriver()` can talk to a Redis Cluster instead of a single node:

```ts
import { reactiveRedisDriver } from 'nuxt-realtime/drivers/redis'

export default defineNuxtConfig({
  nuxtRealtime: {
    storage: reactiveRedisDriver({
      cluster: [{ host: 'redis-1', port: 6379 }, { host: 'redis-2', port: 6379 }],
    }),
  },
})
```

See the [configuration docs](/getting-started/configuration) for details.

## Configurable Socket.IO path

`socketio.path` lets you move the Socket.IO endpoint off the `/socket.io` default (useful behind a reverse proxy that already owns that path). The client and server now derive the same path from this single option.

## Fixes

- Client-supplied storage keys can no longer read or write the internal `_lease:` namespace used for storage expiry.


