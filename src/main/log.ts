import { app } from 'electron'
import { join } from 'node:path'
import { openLogFile, type LogFile, type LogLevel } from '../shared/logFile'

/**
 * The app log: `~/Library/Logs/Obsrv/obsrv.log` on macOS, where Console.app's
 * Log Reports finds it, and Help → Show Log File reveals it. Under the
 * user-data directory when the e2e suite runs, so a test never writes into
 * the real one.
 *
 * Every line is also printed to stderr, which is where `npm run dev` and the
 * e2e runner look. A packaged app launched from the Dock has no stderr at
 * all, which is the reason the file exists: the first field report of a
 * GPU-reset white pane came with no evidence because there was nowhere for
 * any to go.
 */
let file: LogFile | null = null

/** Opens the log. Called once, before `ready`, so boot itself is on record. */
export function initLog(): string {
  if (process.env.OBSRV_TEST === '1') app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
  file = openLogFile(join(app.getPath('logs'), 'obsrv.log'))
  return file.path
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

function emit(level: LogLevel, message: string, cause?: unknown): void {
  const line = cause === undefined ? message : `${message}: ${describe(cause)}`
  file?.write(level, line)
  const out = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error
  out(`obsrv: ${line}`)
}

export const log = {
  info: (message: string, cause?: unknown): void => emit('info', message, cause),
  warn: (message: string, cause?: unknown): void => emit('warn', message, cause),
  error: (message: string, cause?: unknown): void => emit('error', message, cause),
}
