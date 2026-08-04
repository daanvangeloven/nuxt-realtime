import { existsSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { addCustomTab, extendServerRpc, onDevToolsInitialized } from '@nuxt/devtools-kit'
import { logger } from '@nuxt/kit'
import sirv from 'sirv'
import type { Nuxt } from '@nuxt/schema'
import type { Resolver } from '@nuxt/kit'

const RPC_NAMESPACE = 'nuxt-realtime'
const TAB_STATIC_PATH = '/__nuxt-realtime__/tab'
const DEVTOOLS_ROUTE = '/__nuxt-realtime__/devtools'

/**
 * Plain `node:http`/`node:https` GET instead of `ofetch`/global `fetch`: this
 * always targets the same machine's own dev server, which may be configured
 * with a self-signed cert (`devServer.https`) that undici's fetch refuses to
 * trust. `rejectUnauthorized: false` is safe here since the request never
 * leaves loopback.
 */
function fetchDevtoolsJson(baseURL: string, query: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(DEVTOOLS_ROUTE, baseURL)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const get = url.protocol === 'https:' ? httpsGet : httpGet
  // codeql[js/disabling-certificate-validation]: `baseURL` is always `nuxt.options.devServer.url`,
  // this module's own dev server address, not attacker-controlled input, so there is no MITM
  // target to validate against, only a possible self-signed cert (see comment above).
  const options = url.protocol === 'https:' ? { rejectUnauthorized: false } : {}

  return new Promise((resolve, reject) => {
    get(url, options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`nuxt-realtime devtools: ${res.statusCode} ${res.statusMessage}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        }
        catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

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
    // Thin proxies to the dev-only Nitro route registered in socketio.ts.
    // This module (build-time, Kit-side) and the bundled Nitro server don't
    // share a JS module graph, so an actual HTTP hop is used instead of
    // reading server state directly, see the docs for why.
    //
    // `nuxt.options.devServer.url` is read fresh on every call (rather than
    // captured once here) because it's still the pre-listen default when
    // this callback fires; the CLI only patches it to the real bound
    // address once the `listen` hook resolves, which can land after this.
    extendServerRpc(RPC_NAMESPACE, {
      async getConnections() {
        return fetchDevtoolsJson(nuxt.options.devServer.url, { type: 'connections' })
      },
      async getStorageSnapshot() {
        return fetchDevtoolsJson(nuxt.options.devServer.url, { type: 'storage' })
      },
      async getEventLog(sinceId?: number) {
        return fetchDevtoolsJson(nuxt.options.devServer.url, { type: 'events', sinceId })
      },
      async getLockSnapshot() {
        return fetchDevtoolsJson(nuxt.options.devServer.url, { type: 'locks' })
      },
      async getPresenceOverview() {
        return fetchDevtoolsJson(nuxt.options.devServer.url, { type: 'presence' })
      },
      async getRoomMembershipSnapshot() {
        return fetchDevtoolsJson(nuxt.options.devServer.url, { type: 'roomMembers' })
      },
    }, nuxt)
  }, nuxt)
}
