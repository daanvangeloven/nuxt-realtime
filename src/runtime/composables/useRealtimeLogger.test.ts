import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogLevels } from 'consola'
import { useRuntimeConfig } from '#app'
import { useRealtimeLogger } from './useRealtimeLogger'

vi.mock('#app', () => ({
  useRuntimeConfig: vi.fn(),
}))

function mockLevel(level: string | null) {
  vi.mocked(useRuntimeConfig).mockReturnValue({
    public: { nuxtRealtime: { logging: { level } } },
  } as ReturnType<typeof useRuntimeConfig>)
}

describe('useRealtimeLogger', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // --- Level mapping ---

  it.each([
    ['debug', LogLevels.debug],
    ['info', LogLevels.info],
    ['warn', LogLevels.warn],
    ['error', LogLevels.error],
    ['silent', LogLevels.silent],
  ])('maps level "%s" to the correct consola level', (level, expected) => {
    mockLevel(level)
    expect(useRealtimeLogger().level).toBe(expected)
  })

  // --- Fallback behavior (import.meta.dev is undefined/falsy in the test environment,
  //     so the production fallback — LogLevels.warn — applies) ---

  it('falls back to LogLevels.warn when level is null', () => {
    mockLevel(null)
    expect(useRealtimeLogger().level).toBe(LogLevels.warn)
  })

  it('falls back to LogLevels.warn when level is an unknown string', () => {
    mockLevel('verbose')
    expect(useRealtimeLogger().level).toBe(LogLevels.warn)
  })

  it('falls back to LogLevels.warn when level is an empty string', () => {
    mockLevel('')
    expect(useRealtimeLogger().level).toBe(LogLevels.warn)
  })

  it('falls back to LogLevels.warn when level has incorrect casing', () => {
    mockLevel('DEBUG')
    expect(useRealtimeLogger().level).toBe(LogLevels.warn)
  })

  // --- Tag ---

  it('tags the logger with nuxt-realtime', () => {
    mockLevel('info')
    const logger = useRealtimeLogger()
    expect(logger.options.defaults?.tag).toBe('nuxt-realtime')
  })

  // --- Return value ---

  it('returns a consola instance', () => {
    mockLevel('warn')
    const logger = useRealtimeLogger()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })
})
