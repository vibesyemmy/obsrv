import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The app's own log file: a few lines an hour about the things that go wrong
 * where the renderer cannot see them — a GPU process dying, a crashed target,
 * a lost WebGL context, the window going hidden and coming back — so a report
 * from the field arrives with evidence instead of a description.
 *
 * Main-side only (`node:fs`); the line format is separate so it can be tested
 * without a disk. Deliberately synchronous: a line a minute at most, and
 * order matters more than the microseconds — an async queue that reordered
 * "gone" and "restored" would tell the story backwards.
 */

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Rotation point: at this size the file is renamed to `.1` (replacing the
 * previous `.1`) and a fresh one starts, so there are at most two files and
 * two megabytes of history.
 */
export const LOG_MAX_BYTES = 1 << 20

/** Longest line kept; a runaway message would otherwise fill the file alone. */
export const LOG_MAX_LINE = 2000

export interface LogFile {
  readonly path: string
  write(level: LogLevel, message: string): void
}

/** One line: ISO timestamp, level, and the message with its newlines folded. */
export function formatLine(level: LogLevel, message: string, now: Date = new Date()): string {
  const flat = message.replace(/\s*[\r\n]+\s*/g, ' | ').trim()
  const clipped = flat.length > LOG_MAX_LINE ? `${flat.slice(0, LOG_MAX_LINE - 1)}…` : flat
  return `${now.toISOString()} ${level.padEnd(5)} ${clipped}\n`
}

/**
 * Opens the file, creating its directory, and rotates it if it is already
 * over the limit. Never throws, before or after: a log that cannot be
 * written is a log that is silently off, not a reason the app fails to
 * start or a line dies with an exception in the middle of handling one.
 */
export function openLogFile(path: string, maxBytes = LOG_MAX_BYTES): LogFile {
  let broken = false
  const rotateIfLarge = (): void => {
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      return
    }
    if (size < maxBytes) return
    try {
      renameSync(path, `${path}.1`)
    } catch {
      // The next write appends. A long file beats none.
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    rotateIfLarge()
  } catch {
    broken = true
  }
  return {
    path,
    write(level, message) {
      if (broken) return
      try {
        appendFileSync(path, formatLine(level, message))
        rotateIfLarge()
      } catch {
        broken = true
      }
    },
  }
}
