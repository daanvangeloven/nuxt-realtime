import { createResolver } from '@nuxt/kit'

const resolver = createResolver(import.meta.url)

export default defineNuxtConfig({
  modules: ['@nuxt/devtools-ui-kit'],
  ssr: false,
  app: {
    // Must match the sirv mount path in ../src/devtools/setup.ts exactly.
    baseURL: '/__nuxt-realtime__/tab/',
  },
  compatibilityDate: '2026-06-08',
  nitro: {
    output: {
      publicDir: resolver.resolve('./dist'),
    },
  },
  unocss: {
    shortcuts: {
      'bg-active': 'bg-gray:5',
      'bg-hover': 'bg-gray:3',
    },
  },
})
