import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir, logger } from '@nuxt/kit'
import type { StorageMounts } from 'nitropack'
import type { ServerOptions } from 'engine.io'
import type { Server } from 'socket.io'
import type { ReactiveRedisDriverOptions } from './drivers/redis'

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    /**
     * Called with the Socket.IO `Server` instance before it is bound to the
     * transport engine and before any `connection` handlers are registered.
     * Register `io.use()` middleware here to authenticate/authorize clients.
     *
     * @example
     * ```ts
     * // server/plugins/realtime-auth.ts
     * export default defineNitroPlugin((nitroApp) => {
     *   nitroApp.hooks.hook('nuxt-realtime:io', (io) => {
     *     io.use((socket, next) => {
     *       const token = socket.handshake.auth.token
     *       if (!verifyToken(token)) return next(new Error('Unauthorized'))
     *       next()
     *     })
     *   })
     * })
     * ```
     */
    'nuxt-realtime:io': (io: Server) => void | Promise<void>
  }
}

declare module '#app' {
  interface RuntimeNuxtHooks {
    /**
     * Called before every connection attempt (including reconnects). Mutate
     * `ctx.auth` to attach data to the Socket.IO handshake, read on the server
     * via `socket.handshake.auth` inside a `nuxt-realtime:io` middleware.
     *
     * Runs again on every reconnect, so a fresh/refreshed token can be supplied
     * each time rather than baked in once at connect time.
     *
     * @example
     * ```ts
     * // plugins/realtime-auth.client.ts
     * export default defineNuxtPlugin((nuxtApp) => {
     *   nuxtApp.hook('nuxt-realtime:auth', (ctx) => {
     *     ctx.auth.token = useAuthToken().value
     *   })
     * })
     * ```
     */
    'nuxt-realtime:auth': (ctx: { auth: Record<string, unknown> }) => void | Promise<void>
  }
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    nuxtRealtime: {
      socketUrl: string | undefined
      socketPath: string | undefined
      cleanup: { heartbeatInterval: number, cleanupInterval: number, idleThreshold: number } | false
      logging: { level: string | undefined, format: string }
      devtoolsEnabled: boolean
    }
  }

  interface RuntimeConfig {
    nuxtRealtime: {
      redis?: ReactiveRedisDriverOptions
      socketio?: {
        path?: string
        serverOptions?: ServerOptions
      }
      eventLogSize?: number
    }
  }
}

export interface LoggingOptions {
  /**
   * Minimum log level to emit. Defaults to `'debug'` in development and `'warn'` in production.
   * Set to `'silent'` to suppress all output.
   */
  level?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
  /**
   * Log output format.
   * - `'pretty'` (default): human-readable output via consola
   * - `'json'`: newline-delimited JSON, useful for structured log ingestion
   */
  format?: 'pretty' | 'json'
}

export interface CleanupOptions {
  /**
   * How often (ms) the client sends a heartbeat to keep leases alive.
   * @default 30_000
   */
  heartbeatInterval?: number
  /**
   * How often (ms) the server scans for and removes expired leases.
   * @default 300_000
   */
  cleanupInterval?: number
  /**
   * How long (ms) a key can be idle before it is removed.
   * @default 3_600_000
   */
  idleThreshold?: number
}

export interface ModuleOptions {
  /**
   * Storage configuration for the realtime module. Accepts any Nitro storage driver config.
   * For cross-server sync across multiple instances, use the `redis` option instead.
   * @example
   * ```ts
   * storage: {
   *   driver: 'memory', // default
   * }
   * ```
   */
  storage?: StorageMounts[string]

  /**
   * Redis connection options for cross-server state synchronisation.
   * When set, the module uses `reactiveRedisDriver` under the hood, which layers
   * Redis pub/sub on top of the standard Redis storage driver so that writes on
   * one server instance are broadcast to Socket.IO clients connected to other
   * instances in real time.
   *
   * Requires `ioredis >= 5` to be installed as a peer dependency.
   *
   * @example
   * ```ts
   * redis: {
   *   host: 'localhost',
   *   port: 6379,
   * }
   * ```
   *
   * @example Using a Redis URL
   * ```ts
   * redis: {
   *   url: 'redis://localhost:6379',
   * }
   * ```
   */
  redis?: ReactiveRedisDriverOptions

  /**
   * Socket.io configuration options. If not provided, the module will attempt to connect to a socket.io server on the same origin.
   * @example
   * ```ts
   * socketio: {
   *   serverUrl: 'https://my-realtime-server.com',
   *   path: '/socket.io'
   * }
   * ```
   */
  socketio?: {
    serverUrl?: string
    path?: string

    /**
     * Passthrough options for the underlying Engine.IO server
     *
     * @example
     * ```ts
     * serverOptions: {
     *   cors: {
     *     origin: ['https://myapp.com'],
     *     credentials: true,
     *   },
     *   maxHttpBufferSize: 1e6, // 1 MB, the Engine.IO default
     * }
     * ```
     */
    serverOptions?: ServerOptions
  }

  /**
   * Lease-based cleanup for inactive storage keys.
   * Set to `false` to disable. Pass an object to override defaults.
   *
   * @default { heartbeatInterval: 30_000, cleanupInterval: 300_000, idleThreshold: 3_600_000 }
   */
  cleanup?: CleanupOptions | false

  /**
   * Logging configuration for the realtime module.
   * @example
   * ```ts
   * logging: {
   *   level: 'warn', // 'debug' | 'info' | 'warn' | 'error' | 'silent'
   *   format: 'json' // 'pretty' | 'json'
   * }
   * ```
   */
  logging?: LoggingOptions

  /**
   * Configures the "Realtime" Nuxt DevTools tab (connections, storage keys,
   * event log). Only ever active in development. Set to `false` to disable.
   *
   * @default {}
   */
  devtools?: {
    /**
     * Max number of recent events kept in the in-memory event log shown in
     * the DevTools tab.
     * @default 200
     */
    eventLogSize?: number
  } | false
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-realtime',
    configKey: 'nuxtRealtime',
  },
  defaults: {},
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    if (options.redis && options.storage) {
      logger.warn('nuxt-realtime: both `redis` and `storage` are configured. `redis` takes precedence and `storage` will be ignored.')
    }

    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.storage ??= {}
      // When `redis` is set the reactive driver is mounted at runtime by the
      // server plugin; register a memory placeholder so Nitro does not complain
      // about an unconfigured mount.
      if (!options.redis) {
        nitroConfig.storage['nuxt-realtime'] = {
          driver: 'memory',
          ...options.storage,
        }
      }
      else {
        nitroConfig.storage['nuxt-realtime'] = { driver: 'memory' }
      }
    })

    const cleanupConfig = options.cleanup === false
      ? false
      : {
          heartbeatInterval: 30_000,
          cleanupInterval: 300_000,
          idleThreshold: 3_600_000,
          ...options.cleanup,
        }

    const devtoolsEnabled = options.devtools !== false && nuxt.options.dev

    // TODO: add warning if no ws server url is provided and nitro websockets aren't enabled
    nuxt.options.runtimeConfig.public.nuxtRealtime = {
      socketUrl: options.socketio?.serverUrl, // undefined = same origin
      socketPath: options.socketio?.path,
      cleanup: cleanupConfig,
      logging: {
        level: options.logging?.level, // undefined = auto (debug in dev, warn in prod)
        format: options.logging?.format ?? 'pretty',
      },
      devtoolsEnabled,
    }

    nuxt.options.runtimeConfig.nuxtRealtime = {
      redis: options.redis,
      socketio: {
        // Shared with the client (`runtimeConfig.public.nuxtRealtime.socketPath`) so the
        // server route registration and client connection always agree on the same path.
        path: options.socketio?.path,
        serverOptions: options.socketio?.serverOptions,
      },
      eventLogSize: options.devtools === false ? 200 : (options.devtools?.eventLogSize ?? 200),
    }

    // Add server plugin for socket.io initialization
    addServerPlugin(resolver.resolve('./runtime/server/plugins/socketio'))

    // Add client plugin
    addPlugin(resolver.resolve('./runtime/plugin.client'))

    // Add composables for auto-import
    addImportsDir(resolver.resolve('./runtime/composables'))

    if (devtoolsEnabled) {
      const { setupDevtoolsTab } = await import('./devtools/setup')
      setupDevtoolsTab(nuxt, resolver)
    }
  },
})
