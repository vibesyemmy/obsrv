import { describe, expect, it, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

/**
 * `chore-uninstall-remove-end-to-end`: nothing ran `--remove` against a real,
 * populated filesystem and checked what was left afterwards. Everything else
 * about the removal path already had a test with no filesystem
 * (`uninstallRemoval.test.ts`) or the guard alone (`removalGuard.test.ts`,
 * including the sandbox-inside-home refusal this card also asks for) — this
 * is the one arm that runs the real shell (`bin/uninstall.js`) against real
 * files and reads the disk back.
 *
 * **Not CI-only, unlike `uninstallCommand.test.ts`'s reading arm.** That test
 * restricts itself to CI because listing reads whoever runs it's real home.
 * This test never touches a real home at all: `OBSRV_TEST_HOME` and
 * `OBSRV_TEST_SANDBOX_ROOT` (wired in this same change, gated behind
 * `OBSRV_TEST=1` like every other test-only knob here) point the whole
 * pipeline at a fresh `mkdtempSync` tree, and `checkRemoval`'s own
 * sandbox check is the thing that would refuse a mistake here rather than
 * this test's own care being the only thing standing between it and a real
 * profile.
 */

const BIN = join(__dirname, '..', '..', 'bin', 'obsrv.js')

function run(sandboxRoot: string, home: string, ...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, 'uninstall', ...argv], {
    encoding: 'utf8',
    env: { ...process.env, OBSRV_TEST: '1', OBSRV_TEST_HOME: home, OBSRV_TEST_SANDBOX_ROOT: sandboxRoot },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/**
 * `--remove --json` prints the text listing first (deliberately, per
 * `bin/uninstall.js`: "a person watching a delete should see what it is
 * about to take before it takes it") and only then the JSON block — so the
 * two are concatenated on stdout, not pure JSON. `JSON.stringify(x, null, 2)`
 * always opens with a line that is just `{`, which is what locates it.
 */
function parseJsonTail(stdout: string): unknown {
  const at = stdout.lastIndexOf('\n{\n')
  return JSON.parse(at === -1 ? stdout : stdout.slice(at + 1)) as unknown
}

beforeAll(() => {
  expect(existsSync(join(__dirname, '..', '..', 'out', 'shared', 'uninstallReport.js')), 'out/ is missing — run `npm run build` first').toBe(true)
})

/** A populated home, and everywhere that should and should not be touched by `--remove`. */
function populatedHome(sandboxRoot: string): { home: string } {
  const home = join(sandboxRoot, 'home')

  // `plan.remove`: Obsrv's own directories, each with nested content so the
  // test proves recursive removal rather than a directory that happened to
  // be empty.
  mkdirSync(join(home, 'Library/Application Support/Obsrv/nested/deep'), { recursive: true })
  writeFileSync(join(home, 'Library/Application Support/Obsrv/settings.json'), '{}')
  writeFileSync(join(home, 'Library/Application Support/Obsrv/nested/deep/file.txt'), 'x')
  mkdirSync(join(home, 'Library/Logs/Obsrv'), { recursive: true })
  writeFileSync(join(home, 'Library/Logs/Obsrv/obsrv.log'), 'log line\n')

  // `plan.removeFiles`: the four named files inside the SHARED "Electron"
  // directory, each with content that actually parses as Obsrv's own — the
  // fixture is what the plan's own `confirm` labels describe, even though
  // (see the last test below) nothing yet enforces that on the removal path.
  const legacyUserData = join(home, 'Library/Application Support/Electron')
  const legacyLogs = join(home, 'Library/Logs/Electron')
  mkdirSync(legacyUserData, { recursive: true })
  mkdirSync(legacyLogs, { recursive: true })
  writeFileSync(join(legacyUserData, 'history.json'), JSON.stringify([{ url: 'https://example.com', visits: 1, lastVisit: 1000 }]))
  writeFileSync(join(legacyUserData, 'settings.json'), JSON.stringify({ hostDiagonalInches: 13, hostNits: 400 }))
  writeFileSync(join(legacyUserData, 'tabs.json'), JSON.stringify({ tabs: [], activeIndex: 0 }))
  writeFileSync(join(legacyUserData, 'control.json'), JSON.stringify({ port: 1, token: 'x' }))
  writeFileSync(join(legacyLogs, 'obsrv.log'), 'legacy log\n')

  // Sharing the SAME directory: a file with no relation to Obsrv, to prove
  // the directory itself is never removed and only the four named files are.
  writeFileSync(join(legacyUserData, 'some-other-apps-state.db'), 'not obsrv')
  mkdirSync(join(legacyUserData, 'Cache'), { recursive: true })
  writeFileSync(join(legacyUserData, 'Cache', 'blob'), 'chromium cache, not obsrv, not named in the plan')

  // `plan.keep`: real content that must survive untouched.
  mkdirSync(join(home, 'Library/Caches/electron'), { recursive: true })
  writeFileSync(join(home, 'Library/Caches/electron/cached-thing'), 'shared electron cache')
  mkdirSync(join(home, '.obsrv-dev'), { recursive: true })
  writeFileSync(join(home, '.obsrv-dev/lane-state'), 'the dev lane, not this install')
  mkdirSync(join(home, '.claude/skills/obsrv-screens'), { recursive: true })
  writeFileSync(join(home, '.claude/skills/obsrv-screens/SKILL.md'), 'skill, kept by default (no --include-skill)')

  return { home }
}

describe('obsrv uninstall --remove, end to end against a real, disposable filesystem', () => {
  it('removes exactly what the plan claims, and leaves everything it names as kept', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'obsrv-uninstall-e2e-'))
    try {
      const { home } = populatedHome(sandboxRoot)
      const r = run(sandboxRoot, home, '--remove', '--json')
      expect(r.status, r.stderr).toBe(0)
      const answer = parseJsonTail(r.stdout) as {
        removed: { removed: { path: string }[]; failed: unknown[]; refused: unknown[] }
      }
      expect(answer.removed.failed).toEqual([])
      expect(answer.removed.refused).toEqual([])
      expect(answer.removed.removed.map(x => x.path).sort()).toEqual(
        [
          join(home, 'Library/Application Support/Obsrv'),
          join(home, 'Library/Logs/Obsrv'),
          join(home, 'Library/Application Support/Electron/history.json'),
          join(home, 'Library/Application Support/Electron/settings.json'),
          join(home, 'Library/Application Support/Electron/tabs.json'),
          join(home, 'Library/Application Support/Electron/control.json'),
          join(home, 'Library/Logs/Electron/obsrv.log'),
        ].sort(),
      )

      // Gone, recursively.
      expect(existsSync(join(home, 'Library/Application Support/Obsrv'))).toBe(false)
      expect(existsSync(join(home, 'Library/Logs/Obsrv'))).toBe(false)
      // The four named files gone, but the shared directory and the file it
      // shares with some other app both survive.
      const legacyUserData = join(home, 'Library/Application Support/Electron')
      expect(existsSync(join(legacyUserData, 'history.json'))).toBe(false)
      expect(existsSync(join(legacyUserData, 'settings.json'))).toBe(false)
      expect(existsSync(join(legacyUserData, 'tabs.json'))).toBe(false)
      expect(existsSync(join(legacyUserData, 'control.json'))).toBe(false)
      expect(existsSync(join(legacyUserData, 'some-other-apps-state.db'))).toBe(true)
      expect(existsSync(join(legacyUserData, 'Cache', 'blob'))).toBe(true)
      expect(existsSync(join(home, 'Library/Logs/Electron/obsrv.log'))).toBe(false)
      expect(existsSync(join(home, 'Library/Logs/Electron'))).toBe(true)
      // Kept, untouched.
      expect(existsSync(join(home, 'Library/Caches/electron/cached-thing'))).toBe(true)
      expect(existsSync(join(home, '.obsrv-dev/lane-state'))).toBe(true)
      expect(existsSync(join(home, '.claude/skills/obsrv-screens/SKILL.md'))).toBe(true)
      // The sandbox root itself is not part of what a real machine has —
      // nothing above should have needed anything outside it to exist.
      expect(readdirSync(sandboxRoot)).toContain('home')
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('a symlink target inside a removed tree is unlinked, not followed', () => {
    // The mechanism `uninstallRemoval.test.ts` already pins without a
    // filesystem; this is that same shape through the real shell and a real
    // `rmSync`, against a target it must not touch.
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'obsrv-uninstall-e2e-symlink-'))
    const outsideTarget = mkdtempSync(join(tmpdir(), 'obsrv-uninstall-e2e-outside-'))
    try {
      const { home } = populatedHome(sandboxRoot)
      writeFileSync(join(outsideTarget, 'must-survive.txt'), 'not this install’s to remove')
      symlinkSync(outsideTarget, join(home, 'Library/Application Support/Obsrv/nested/link-out'))

      const r = run(sandboxRoot, home, '--remove', '--json')
      expect(r.status, r.stderr).toBe(0)

      expect(existsSync(join(home, 'Library/Application Support/Obsrv'))).toBe(false)
      // The link is gone (it was inside a removed tree), but what it pointed
      // at, outside the sandbox entirely, was never descended into.
      expect(existsSync(join(outsideTarget, 'must-survive.txt'))).toBe(true)
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true })
      rmSync(outsideTarget, { recursive: true, force: true })
    }
  })

  it('refuses a sandbox root that resolves inside the real home, even from the CLI', () => {
    // `removalGuard.test.ts` already proves `checkRemoval` refuses this in
    // isolation; this is the one check that the wiring in `bin/uninstall.js`
    // does not quietly bypass it by, say, forgetting to pass `sandboxRoot`
    // through on one of the two call sites. `checkRemoval` is never told a
    // different `realHome` from here, so it always judges against the actual
    // passwd home (`userInfo().homedir`) regardless of `OBSRV_TEST_HOME` —
    // that guarantee is what this asserts, using a real (if nonexistent)
    // path under it rather than the test's own fake home.
    //
    // Read via plain `--json` (no `--remove`): a bad sandbox refuses at the
    // LISTING stage, so `report.present` is empty and `removeListed` — the
    // thing `--remove`'s own JSON reports on — never even loops. Its exit
    // code is 0 with nothing to remove, which is correct but proves nothing
    // about the guard on its own; the listing's own `refused` entries are
    // where the refusal is actually visible.
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'obsrv-uninstall-e2e-'))
    const sandboxInsideRealHome = join(userInfo().homedir, 'obsrv-uninstall-e2e-probe-never-created')
    try {
      const { home } = populatedHome(sandboxRoot)
      const listing = run(sandboxInsideRealHome, home, '--json')
      expect(listing.status, listing.stderr).toBe(0)
      const answer = parseJsonTail(listing.stdout) as { present: unknown[]; refused: { path: string; refused?: string }[] }
      expect(answer.present).toEqual([])
      expect(answer.refused.length).toBeGreaterThan(0)
      expect(answer.refused.every(x => (x.refused ?? '').includes('sandbox'))).toBe(true)

      // And, end to end: asking it to `--remove` under the same bad sandbox
      // removes nothing — the safety property that actually matters — even
      // though the JSON it prints under `--remove` cannot see this refusal.
      const removed = run(sandboxInsideRealHome, home, '--remove', '--json')
      expect(removed.status, removed.stderr).toBe(0)
      const removedAnswer = parseJsonTail(removed.stdout) as { removed: { removed: unknown[] } }
      expect(removedAnswer.removed.removed).toEqual([])
      expect(existsSync(join(home, 'Library/Application Support/Obsrv'))).toBe(true)
      // The probe path was never created by anything — the guard is pure and
      // never needed it to exist to refuse it.
      expect(existsSync(sandboxInsideRealHome)).toBe(false)
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true })
    }
  })

  // NOT ENFORCED TODAY, measured rather than assumed: `Removal.confirm`
  // documents that a generically-named file in the shared Electron directory
  // must parse as Obsrv's own before removal ("the command must apply it
  // before removing them"), but neither `uninstallReport.ts` nor
  // `uninstallRemoval.ts` nor `bin/uninstall.js` actually parses one — `look`
  // only checks existence, and `removeListed` only re-runs the path-based
  // guard. This test exists to say so with a real file rather than a reading
  // of the source: a `history.json` that is garbage gets removed anyway.
  // Filed separately as `bug-uninstall-confirm-unenforced` rather than fixed
  // here — implementing the check is its own piece of work, and folding it
  // into this card would be the scope creep `CONTRIBUTING.md` warns against.
  it('a generically-named file that does not parse as Obsrv\u2019s own survives, and is named', () => {
    // Was `KNOWN GAP`, inverted by `bug-uninstall-confirm-unenforced`'s fix.
    // The gap version asserted `existsSync(...) === false` and carried a note
    // saying to invert it when `Removal.confirm` was finally wired up. This is
    // that inversion: same fixture, opposite expectation.
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'obsrv-uninstall-e2e-gap-'))
    try {
      const { home } = populatedHome(sandboxRoot)
      const legacyUserData = join(home, 'Library/Application Support/Electron')
      const foreign = join(legacyUserData, 'history.json')
      // **Valid JSON of the wrong shape**, not the bug card's original
      // `'not json at all'`. Idris found the difference by mutation while
      // reviewing this PR: unparseable bytes are caught by `bin/uninstall.js`'s
      // own `JSON.parse` try/catch and never reach `confirmsAs`, so a build
      // with `confirmsAs` forced to `true` still passed this test. It was
      // named the control for the shape check and exercised everything except
      // the shape check. This fixture parses, so the only thing that can keep
      // it is `confirmsAs` returning false — which is what the control was
      // always supposed to be about.
      writeFileSync(foreign, JSON.stringify({ entries: [] }))

      const r = run(sandboxRoot, home, '--remove', '--json')
      // Exit 0: the command did its job. A file it could not attribute to
      // Obsrv was never in the set the caller asked it to remove, so leaving
      // it is the check working rather than the removal failing.
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(foreign), 'another app\u2019s file was deleted out of a shared directory').toBe(true)

      // And it is named, with a reason. Surviving silently would be the same
      // defect wearing the opposite outcome: a person cannot act on a file
      // they are not told about.
      const out = parseJsonTail(r.stdout) as { removed: { removed: { path: string }[]; unconfirmed: { path: string; because: string }[] } }
      expect(out.removed.unconfirmed.map(u => u.path), JSON.stringify(out.removed.unconfirmed)).toContain(foreign)
      expect(out.removed.removed.map(x => x.path)).not.toContain(foreign)
      // The reason names the shared directory, which is the fact that makes
      // the refusal make sense to someone reading it cold.
      expect(out.removed.unconfirmed[0]?.because).toMatch(/shared with every other unnamed Electron app/)
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true })
    }
  })
})
