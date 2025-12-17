export default defineNuxtConfig({
  modules: ['../src/module'],
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  nuxtRealtime: {
    storage: {
      driver: 'memory',
    },
  },
})
