// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    '@barzhsieh/nuxt-content-mermaid',
    'nuxt-og-image',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  content: {
    build: {
      markdown: {
        toc: {
          searchDepth: 1,
        },
      },
    },
  },

  experimental: {
    asyncContext: true,
  },

  compatibilityDate: '2024-07-11',

  nitro: {
    prerender: {
      routes: [
        '/',
      ],
      crawlLinks: true,
      autoSubfolderIndex: false,
    },
  },

  vite: {
    optimizeDeps: {
      include: ['dayjs'],
    },
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs',
      },
    },
  },

  icon: {
    provider: 'iconify',
  },
})
