import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removalLines, removeListed } from '../../src/shared/uninstallRemoval'
import type { UninstallReport } from '../../src/shared/uninstallReport'
import type { GuardVerdict } from '../../src/shared/removalGuard'

/**
 * The removing half, tested with **no real filesystem for any decision it
 * makes** — and one test that does touch a filesystem, deliberately, under
 * `os.tmpdir()` and nowhere near a home.
 *
 * An uninstaller's tests are the one place where getting the sandbox wrong
 * deletes someone's history. So the decisions are pure and injected, and the
 * single fact that cannot be reasoned about — what Node's recursive remove does
 * when it meets a symlinked directory — is measured in a temp tree built and
 * torn down by the test itself.
 */

const HOME = '/Users/someone'
const allow = (path: string): GuardVerdict => ({ allow: true, path })

const report = (present: { path: string; bytes?: number }[], extra: Partial<UninstallReport> = {}): UninstallReport => ({
  present: present.map(p => ({ path: p.path, what: 'data', bytes: p.bytes })),
  absent: [],
  refused: [],
  keep: [],
  note: null,
  unmeasured: false,
  commands: [],
  ...extra,
})

describe('removeListed', () => {
  it('removes exactly what the report listed as present, and nothing else', () => {
    const asked: string[] = []
    const r = removeListed({
      report: report([{ path: `${HOME}/Library/Application Support/Obsrv` }]),
      check: allow,
      remove: p => asked.push(p),
    })
    expect(asked).toEqual([`${HOME}/Library/Application Support/Obsrv`])
    expect(r.removed.map(x => x.path)).toEqual([`${HOME}/Library/Application Support/Obsrv`])
    expect(r.failed).toEqual([])
    expect(r.refused).toEqual([])
  })

  it('never touches the absent, the refused or the kept', () => {
    // Each of these is a path the report deliberately did NOT put in `present`.
    // An `rm` of an absent path reports success for removing nothing; an `rm`
    // of a refused one is the exact thing the guard exists to stop; the keep
    // list is somebody else's data.
    const asked: string[] = []
    removeListed({
      report: report([], {
        absent: [{ path: `${HOME}/Library/Logs/Obsrv`, what: 'logs' }],
        refused: [{ path: `${HOME}`, what: 'home', refused: 'resolves to the real home' }],
        keep: [{ path: `${HOME}/Library/Caches/electron`, why: "Electron's own cache" }],
      }),
      check: allow,
      remove: p => asked.push(p),
    })
    expect(asked).toEqual([])
  })

  it('re-checks each path AT the moment it removes that path, not once up front', () => {
    // The report's check can be minutes old. The one that counts is the one
    // holding the `rm`, so the order must interleave: check A, remove A, check
    // B, remove B — never check A, check B, remove A, remove B.
    const order: string[] = []
    removeListed({
      report: report([{ path: `${HOME}/a` }, { path: `${HOME}/b` }]),
      check: p => {
        order.push(`check ${p}`)
        return allow(p)
      },
      remove: p => order.push(`remove ${p}`),
    })
    expect(order).toEqual([`check ${HOME}/a`, `remove ${HOME}/a`, `check ${HOME}/b`, `remove ${HOME}/b`])
  })

  it('obeys the guard over the report when the two disagree, and says they did', () => {
    const asked: string[] = []
    const r = removeListed({
      report: report([{ path: `${HOME}/a` }, { path: `${HOME}/b` }]),
      // The report allowed both; the guard now refuses one.
      check: p => (p.endsWith('/a') ? { allow: false, refuse: 'resolves inside the real home' } : allow(p)),
      remove: p => asked.push(p),
    })
    expect(asked).toEqual([`${HOME}/b`])
    expect(r.refused).toEqual([{ path: `${HOME}/a`, because: 'resolves inside the real home' }])
    expect(r.removed.map(x => x.path)).toEqual([`${HOME}/b`])
  })

  it('carries on after a failure, and names the one that is still there', () => {
    const r = removeListed({
      report: report([{ path: `${HOME}/a` }, { path: `${HOME}/b` }, { path: `${HOME}/c` }]),
      check: allow,
      remove: p => {
        if (p.endsWith('/b')) throw new Error('EACCES: permission denied')
      },
    })
    expect(r.removed.map(x => x.path)).toEqual([`${HOME}/a`, `${HOME}/c`])
    expect(r.failed).toEqual([{ path: `${HOME}/b`, because: 'EACCES: permission denied' }])
    // And the words name it, rather than saying "some removals failed".
    expect(removalLines(r).join('\n')).toContain(`${HOME}/b`)
    expect(removalLines(r).join('\n')).toContain('Still here')
  })

  it('removes nothing at all on a platform nobody measured', () => {
    const asked: string[] = []
    const r = removeListed({
      report: report([{ path: 'C:/Users/someone/AppData/Obsrv' }], { unmeasured: true }),
      check: allow,
      remove: p => asked.push(p),
    })
    expect(asked).toEqual([])
    expect(r.unmeasured).toBe(true)
    expect(removalLines(r)[0]).toContain('nothing measured to remove on this platform')
  })
})

/**
 * The one fact this module asserts about its caller that cannot be reasoned
 * about: `Remove` is specified as link-respecting, and `bin/uninstall.js`
 * satisfies it with `rmSync({ recursive: true })`.
 *
 * `removalGuard`'s own comment is explicit that it narrows the symlink hole
 * rather than closing it, and that **the caller must not descend into links**.
 * So the caller's tool is measured here rather than trusted: a symlinked
 * directory inside the tree being removed must be unlinked, and whatever it
 * points at must survive.
 */
describe("what the caller's `rm` does to a symlink, measured", () => {
  it('unlinks the link and leaves its target alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'obsrv-rm-symlink-'))
    try {
      const doomed = join(root, 'doomed')
      const keep = join(root, 'keep')
      mkdirSync(doomed)
      mkdirSync(keep)
      writeFileSync(join(keep, 'precious.txt'), 'do not delete me')
      // The shape the guard warns about: a link inside the directory being
      // removed, pointing at something outside it.
      symlinkSync(keep, join(doomed, 'link-to-keep'))
      expect(lstatSync(join(doomed, 'link-to-keep')).isSymbolicLink()).toBe(true)

      rmSync(doomed, { recursive: true, force: true })

      expect(existsSync(doomed)).toBe(false)
      // The whole point: the target is untouched, contents and all.
      expect(existsSync(keep)).toBe(true)
      expect(readdirSync(keep)).toEqual(['precious.txt'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
