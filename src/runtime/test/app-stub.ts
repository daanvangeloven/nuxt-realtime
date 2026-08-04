/**
 * Resolution target for the `#app` alias in vitest.config.ts. Nuxt's real `#app` only exists
 * inside a running Nuxt build, so tests that import a `.vue` component (which statically
 * imports `#app`) need something on disk for Vite to resolve — always override these with
 * `vi.mock('#app', ...)` in the test file; this stub only throws if that mock is missing.
 */
function unmocked(name: string): never {
  throw new Error(`#app's ${name} was called without a vi.mock('#app', ...) in this test`)
}

export function useNuxtApp(): never {
  return unmocked('useNuxtApp')
}

export function useAppConfig(): never {
  return unmocked('useAppConfig')
}
