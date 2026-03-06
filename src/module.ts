import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir, logger } from '@nuxt/kit'
import type { StorageMounts, NitroConfig } from 'nitropack'

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
   * Storage configuration for the realtime module.
   * @example
   * ```ts
   * storage: {
   *   driver: 'redis',
   *   host: 'localhost',
   *   port: 6379,
   * }
   * ```
   */
  storage?: StorageMounts[string]

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
  }

  /**
   * Lease-based cleanup for inactive storage keys.
   * Set to `false` to disable. Pass an object to override defaults.
   *
   * @default { heartbeatInterval: 30_000, cleanupInterval: 300_000, idleThreshold: 3_600_000 }
   */
  cleanup?: CleanupOptions | false
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-realtime',
    configKey: 'nuxtRealtime',
  },
  defaults: {
    storage: {
      driver: 'memory',
    },
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    logger.warn('nuxt-realtime is in early development. APIs may change without notice.')

    // @ts-expect-error - nitro:config hook exists at runtime but is not typed in NuxtHooks in Nuxt 4
    nuxt.hook('nitro:config', (nitroConfig: NitroConfig) => {
      nitroConfig.storage ??= {}
      nitroConfig.storage['nuxt-realtime'] = {
        driver: 'memory',
        ...options.storage,
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

    // TODO: add warning if no ws server url is provided and nitro websockets aren't enabled
    nuxt.options.runtimeConfig.public.nuxtRealtime = {
      socketUrl: options.socketio?.serverUrl, // undefined = same origin
      socketPath: options.socketio?.path,
      cleanup: cleanupConfig,
    }

    // Add server plugin for socket.io initialization
    addServerPlugin(resolver.resolve('./runtime/server/plugins/socketio'))

    // Add client plugin
    addPlugin(resolver.resolve('./runtime/plugin.client'))

    // Add composables for auto-import
    addImportsDir(resolver.resolve('./runtime/composables'))
  },
})
