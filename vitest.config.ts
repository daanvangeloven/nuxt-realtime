import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Nuxt's real `#app` only exists inside a running Nuxt build. `.vue` components that
    // statically import it need something resolvable on disk; tests override it per-file
    // with vi.mock('#app', ...).
    alias: {
      '#app': fileURLToPath(new URL('./src/runtime/test/app-stub.ts', import.meta.url)),
    },
  },
  define: {
    'import.meta.client': true,
    'import.meta.server': false,
  },
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  },
})
