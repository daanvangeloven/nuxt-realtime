import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir, logger } from '@nuxt/kit'
import type { StorageMounts } from 'nitropack'

export interface ModuleOptions {
  storage?: StorageMounts[string]
  socketio?: {
    serverUrl?: string
    path?: string
  }
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

    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.storage ??= {}
      nitroConfig.storage['nuxt-realtime'] = {
        driver: 'memory',
        ...options.storage,
      }
    })

    // TODO: add warning if no ws server url is provided and nitro websockets aren't enabled
    nuxt.options.runtimeConfig.public.nuxtRealtime = {
      socketUrl: options.socketio?.serverUrl, // undefined = same origin
      socketPath: options.socketio?.path,
    }

    // Add server plugin for socket.io initialization
    addServerPlugin(resolver.resolve('./runtime/server/plugins/socketio'))

    // Add client plugin
    addPlugin(resolver.resolve('./runtime/plugin'))

    // Add composables for auto-import
    addImportsDir(resolver.resolve('./runtime/composables'))
  },
})
