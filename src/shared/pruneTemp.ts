import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A day. Old enough that no caller is still holding the path. */
export const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** How many to remove in one pass, so a startup is never held up by a backlog. */
export const TEMP_PRUNE_LIMIT = 200

/**
 * Remove the temp directories a previous run left behind.
 *
 * Every live capture writes its PNG into a fresh `obsrv-mcp-*` directory and
 * answers with the path, so the directory cannot be removed when the call
 * returns — the client has not read it yet. Nothing removed them afterwards
 * either: one machine held **10,045 `obsrv-*` entries and 400 MB**, 2,139 of
 * them from a single day (2026-09-13, cleaned by hand). Age is the only safe
 * discriminator, since a recent directory may be a path an agent is about to
 * open, and a prefix is the only safe scope: the specs keep their own temp
 * directories and it is not this function's business to remove them.
 *
 * Best effort by construction — it runs at startup and must never be the
 * reason a server fails to start, so every step swallows its own failure and
 * the answer is a count rather than a promise about the filesystem.
 */
export function pruneTempDirs({
  dir,
  prefix,
  olderThanMs = TEMP_MAX_AGE_MS,
  limit = TEMP_PRUNE_LIMIT,
  now = Date.now(),
}: {
  dir: string
  prefix: string
  olderThanMs?: number
  limit?: number
  now?: number
}): number {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (removed >= limit) break
    if (!name.startsWith(prefix)) continue
    const path = join(dir, name)
    try {
      if (now - statSync(path).mtimeMs < olderThanMs) continue
      rmSync(path, { recursive: true, force: true })
      removed++
    } catch {
      // A directory that vanished under us, or one we may not remove: neither
      // is worth failing a startup over, and the next run will try again.
    }
  }
  return removed
}
