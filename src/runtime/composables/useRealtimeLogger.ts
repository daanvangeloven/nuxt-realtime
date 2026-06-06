import { createConsola, LogLevels } from 'consola'
import type { ConsolaInstance } from 'consola'
import { useRuntimeConfig } from '#app'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_MAP: Record<LogLevel, number> = {
  debug: LogLevels.debug,
  info: LogLevels.info,
  warn: LogLevels.warn,
  error: LogLevels.error,
  silent: LogLevels.silent,
}

let _logger: ConsolaInstance | undefined

export function _resetLogger() {
  _logger = undefined
}

export function useRealtimeLogger(): ConsolaInstance {
  if (_logger) return _logger

  const { level, format } = (useRuntimeConfig().public.nuxtRealtime as { logging: { level: string | undefined, format: string } }).logging
  const resolvedLevel = (level && level in LEVEL_MAP)
    ? LEVEL_MAP[level as LogLevel]
    : (import.meta.dev ? LogLevels.debug : LogLevels.warn)

  _logger = createConsola({ level: resolvedLevel }).withTag('nuxt-realtime')

  if (format === 'json' && import.meta.server) {
    _logger.setReporters([{
      log(logObj) {
        const out = ['error', 'fatal', 'warn'].includes(logObj.type) ? process.stderr : process.stdout
        const message = logObj.args.map(a => (a instanceof Error ? a.message : String(a))).join(' ')
        const errorArg = logObj.args.find((a): a is Error => a instanceof Error)
        const dataArg = errorArg === undefined ? logObj.args[1] : undefined
        out.write(JSON.stringify({
          level: logObj.type,
          tag: logObj.tag,
          message,
          ...(dataArg != null && typeof dataArg === 'object' ? { data: dataArg } : {}),
          ...(errorArg != null ? { error: { message: errorArg.message, stack: errorArg.stack } } : {}),
          date: logObj.date,
        }) + '\n')
      },
    }])
  }

  return _logger
}
