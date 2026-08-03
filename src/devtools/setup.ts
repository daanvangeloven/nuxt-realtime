import { existsSync } from 'node:fs'
import { addCustomTab, extendServerRpc, onDevToolsInitialized } from '@nuxt/devtools-kit'
import { logger } from '@nuxt/kit'
import { $fetch } from 'ofetch'
import sirv from 'sirv'
import type { Nuxt } from '@nuxt/schema'
import type { Resolver } from '@nuxt/kit'

const RPC_NAMESPACE = 'nuxt-realtime'
const TAB_STATIC_PATH = '/__nuxt-realtime__/tab'
const DEVTOOLS_ROUTE = '/__nuxt-realtime__/devtools'

export function setupDevtoolsTab(nuxt: Nuxt, resolver: Resolver): void {
  // `resolver` is created in module.ts with `createResolver(import.meta.url)`,
  // so it resolves relative to module.ts's own directory (`src/` in dev,
  // `dist/` once built), both exactly one level below the package root.
  const clientDist = resolver.resolve('../client/dist')

  if (!existsSync(clientDist)) {
    logger.warn('nuxt-realtime: `client/dist` not found, skipping the DevTools tab. Run `pnpm run build:devtools-client` to build it.')
    return
  }

  // Serves the prebuilt client SPA. No vite-dev-server proxy for hot-reloading
  // the tab UI mid-development: `client/dist` is always prebuilt (see
  // `build:devtools-client` in package.json)
  nuxt.hook('vite:serverCreated', (server, { isClient }) => {
    if (!isClient) return
    server.middlewares.use(TAB_STATIC_PATH, sirv(clientDist, { single: true, dev: true }))
  })

  addCustomTab({
    name: RPC_NAMESPACE,
    title: 'Realtime',
    icon: 'i-lucide-radio-tower',
    view: {
      type: 'iframe',
      src: TAB_STATIC_PATH,
    },
  }, nuxt)

  onDevToolsInitialized(() => {
    // Thin $fetch proxies to the dev-only Nitro route registered in
    // socketio.ts. This module (build-time, Kit-side) and the bundled Nitro
    // server don't share a JS module graph, so an actual HTTP hop is used
    // instead of reading server state directly, see the docs for why.
    //
    // `nuxt.options.devServer.url` is read fresh on every call (rather than
    // captured once here) because it's still the pre-listen default when
    // this callback fires; the CLI only patches it to the real bound
    // address once the `listen` hook resolves, which can land after this.
    extendServerRpc(RPC_NAMESPACE, {
      async getConnections() {
        return $fetch(DEVTOOLS_ROUTE, { baseURL: nuxt.options.devServer.url, query: { type: 'connections' } })
      },
      async getStorageSnapshot() {
        return $fetch(DEVTOOLS_ROUTE, { baseURL: nuxt.options.devServer.url, query: { type: 'storage' } })
      },
      async getEventLog(sinceId?: number) {
        return $fetch(DEVTOOLS_ROUTE, { baseURL: nuxt.options.devServer.url, query: { type: 'events', sinceId } })
      },
    }, nuxt)
  }, nuxt)
}
