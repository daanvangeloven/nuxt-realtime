import { createConsola, LogLevels } from 'consola'
import type { ConsolaInstance } from 'consola'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_MAP: Record<LogLevel, number> = {
  debug: LogLevels.debug,
  info: LogLevels.info,
  warn: LogLevels.warn,
  error: LogLevels.error,
  silent: LogLevels.silent,
}

/**
 * Creates a tagged consola logger for nuxt-realtime.
 *
 * @param level - Explicit log level, or `null` to auto-select based on environment
 *                (`'debug'` in dev, `'warn'` in production).
 * @param format - `'pretty'` (default) for human-readable output, `'json'` for
 *                 newline-delimited JSON suitable for structured log ingestion.
 */
export function createRealtimeLogger(level: string | null, format: string): ConsolaInstance {
  const resolvedLevel: LogLevel = (level && level in LEVEL_MAP)
    ? level as LogLevel
    : (import.meta.dev ? 'debug' : 'warn')

  const logger = createConsola({ level: LEVEL_MAP[resolvedLevel] }).withTag('nuxt-realtime')

  if (format === 'json') {
    logger.setReporters([{
      log(logObj) {
        const message = logObj.args.map(a => (a instanceof Error ? a.message : String(a))).join(' ')
        const extra = logObj.args.find(a => a instanceof Error) ?? logObj.args[1]
        process.stdout.write(JSON.stringify({
          level: logObj.type,
          tag: logObj.tag,
          message,
          ...(extra && !(extra instanceof Error) ? { data: extra } : {}),
          ...(extra instanceof Error ? { error: { message: extra.message, stack: extra.stack } } : {}),
          date: logObj.date,
        }) + '\n')
      },
    }])
  }

  return logger
}
