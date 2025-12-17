import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir } from '@nuxt/kit'

export interface ModuleOptions {
  storage: {
    driver?: 'redis' | 'fs' | 'memory' | string
    options?: Record<string, unknown>
  }
  socketio: {
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

    // TODO: implement storage driver options
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
