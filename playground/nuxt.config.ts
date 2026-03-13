export default defineNuxtConfig({
  modules: ['nuxt-realtime', '@nuxt/ui'],
  css: ['~/assets/main.css'],
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  nuxtRealtime: {
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  },
},
)
