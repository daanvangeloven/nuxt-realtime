import { createConsola, LogLevels } from 'consola'
import type { ConsolaInstance } from 'consola'
import { useRuntimeConfig } from '#app'

const LEVEL_MAP: Record<string, number> = {
  debug: LogLevels.debug,
  info: LogLevels.info,
  warn: LogLevels.warn,
  error: LogLevels.error,
  silent: LogLevels.silent,
}

export function useRealtimeLogger(): ConsolaInstance {
  const { level } = (useRuntimeConfig().public.nuxtRealtime as { logging: { level: string | null } }).logging
  const resolvedLevel = (level && level in LEVEL_MAP)
    ? LEVEL_MAP[level]
    : (import.meta.dev ? LogLevels.debug : LogLevels.warn)
  return createConsola({ level: resolvedLevel }).withTag('nuxt-realtime')
}
