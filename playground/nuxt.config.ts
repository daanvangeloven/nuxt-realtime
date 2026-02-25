export default defineNuxtConfig({
  modules: ['nuxt-realtime', '@nuxt/ui'],
  css: ['~/assets/main.css'],
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  nuxtRealtime: {
    storage: {
      driver: 'redis',
      host: 'localhost',
      port: 6379,
    },
  },
},
)
