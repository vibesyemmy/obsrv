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

/**
 * Which Obsrv wrote a line.
 *
 * `--user-data-dir` moves `userData` and not `logs`, so a dev-lane app and the
 * installed app write the same `obsrv.log` and nothing in a line says which.
 * Whether they have interleaved is not merely unknown but unknowable from the
 * artefact: with no field naming a writer, "no lines mention the lane" fits
 * *never wrote* and *wrote anonymously* equally. The stamp cannot answer that
 * backwards; it stops the question being unanswerable from here on.
 *
 * **The identity is the profile and the process, not the build.** Two lanes
 * off one commit are the same code and different Obsrvs; a tag naming the
 * build would call them one writer, which is the failure this is for. The
 * profile (`userData`) is what actually separates instances — it is exactly
 * what `--user-data-dir` moves — and the pid separates two runs of one
 * profile. Kind comes first because it is what a human wants at a glance.
 *
 * Modelled on the dev lane's own MCP reply, which names the tree it serves and
 * caught a false green twice on 2026-09-15.
 */
export function writerTag(w: { userData: string; pid: number; packaged: boolean; env: Record<string, string | undefined> }): string {
  const kind = w.packaged
    ? 'app'
    : w.env.OBSRV_TEST === '1'
      ? 'test'
      : w.env.OBSRV_DEV_LANE !== undefined
        ? w.env.OBSRV_DEV_LANE_LABEL !== undefined && w.env.OBSRV_DEV_LANE_LABEL !== ''
          ? `lane:${w.env.OBSRV_DEV_LANE_LABEL}`
          : `lane:${profileMark(w.userData)}`
        : `dev:${profileMark(w.userData)}`
  return `${kind}#${w.pid}`
}

/**
 * Four hex characters of the profile path: enough to tell two profiles apart
 * in a log a person is reading, short enough not to crowd the line. Not a
 * security boundary and not reversible — it answers "are these the same
 * writer?", which is the only question the log is asked.
 */
function profileMark(userData: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < userData.length; i++) {
    h ^= userData.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h >>> 16).toString(16).padStart(4, '0')
}

/**
 * One line: ISO timestamp, level, the writer when there is one, and the
 * message with its newlines folded. The writer is omitted rather than faked
 * when a caller has none — a blank column would read as an instance.
 */
export function formatLine(level: LogLevel, message: string, now: Date = new Date(), writer?: string): string {
  const flat = message.replace(/\s*[\r\n]+\s*/g, ' | ').trim()
  const clipped = flat.length > LOG_MAX_LINE ? `${flat.slice(0, LOG_MAX_LINE - 1)}…` : flat
  return `${now.toISOString()} ${level.padEnd(5)} ${writer === undefined ? '' : `${writer} `}${clipped}\n`
}

/**
 * Opens the file, creating its directory, and rotates it if it is already
 * over the limit. Never throws, before or after: a log that cannot be
 * written is a log that is silently off, not a reason the app fails to
 * start or a line dies with an exception in the middle of handling one.
 */
/**
 * `writer` stamps every line this process writes (see `writerTag`). Optional
 * so a caller with no identity to give omits the column rather than printing
 * an empty one, which would read as an instance whose name was lost.
 */
export function openLogFile(path: string, maxBytes = LOG_MAX_BYTES, writer?: string): LogFile {
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
        appendFileSync(path, formatLine(level, message, new Date(), writer))
        rotateIfLarge()
      } catch {
        broken = true
      }
    },
  }
}
