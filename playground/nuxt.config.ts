export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/ui'],
  css: ['~/assets/main.css'],
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
