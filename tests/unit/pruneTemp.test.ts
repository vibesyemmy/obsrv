import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneTempDirs } from '../../src/shared/pruneTemp'

/**
 * Every live capture writes its PNG into a fresh `obsrv-mcp-*` directory and
 * hands the caller its path, so the directory cannot be removed when the call
 * ends — the client has not read it yet. Nothing removed them later either:
 * 10,045 entries and 400 MB on one machine, 2,139 of them from a single day
 * (2026-09-13). Age is the only safe discriminator, since a recent one may be
 * a path an agent is about to open.
 */
const dayMs = 24 * 60 * 60 * 1000

const makeDir = (root: string, name: string, ageMs: number): string => {
  const dir = join(root, name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'live.png'), 'x')
  const when = new Date(Date.now() - ageMs)
  utimesSync(dir, when, when)
  return dir
}

describe('pruning the temp directories a capture leaves behind', () => {
  it('removes the old ones of its own prefix and keeps everything else', () => {
    const root = mkdtempSync(join(tmpdir(), 'obsrv-prune-test-'))
    try {
      makeDir(root, 'obsrv-mcp-old1', 3 * dayMs)
      makeDir(root, 'obsrv-mcp-old2', 2 * dayMs)
      makeDir(root, 'obsrv-mcp-recent', 60_000)
      // Another prefix, equally old: the specs' own, and not ours to remove.
      makeDir(root, 'obsrv-cli-old', 3 * dayMs)
      makeDir(root, 'unrelated-old', 3 * dayMs)
      const removed = pruneTempDirs({ dir: root, prefix: 'obsrv-mcp-', olderThanMs: dayMs })
      expect(removed).toBe(2)
      expect(readdirSync(root).sort()).toEqual(['obsrv-cli-old', 'obsrv-mcp-recent', 'unrelated-old'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stops at its limit, so a machine with ten thousand of them does not stall a startup', () => {
    const root = mkdtempSync(join(tmpdir(), 'obsrv-prune-test-'))
    try {
      for (let i = 0; i < 10; i++) makeDir(root, `obsrv-mcp-${i}`, 3 * dayMs)
      expect(pruneTempDirs({ dir: root, prefix: 'obsrv-mcp-', olderThanMs: dayMs, limit: 4 })).toBe(4)
      expect(readdirSync(root)).toHaveLength(6)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers zero rather than throwing when the directory is not there', () => {
    // Best effort by construction: this runs at startup and must never be the
    // reason a server fails to start.
    expect(pruneTempDirs({ dir: join(tmpdir(), 'obsrv-prune-absent-dir'), prefix: 'obsrv-mcp-', olderThanMs: dayMs })).toBe(0)
  })
})
