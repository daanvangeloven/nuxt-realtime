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
export function createRealtimeLogger(level: string | null | undefined, format: string): ConsolaInstance {
  const resolvedLevel: LogLevel = (level && level in LEVEL_MAP)
    ? level as LogLevel
    : (import.meta.dev ? 'debug' : 'warn')

  const logger = createConsola({ level: LEVEL_MAP[resolvedLevel] }).withTag('nuxt-realtime')

  if (format === 'json') {
    logger.setReporters([{
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

  return logger
}
