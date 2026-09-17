import { describe, expect, it } from 'vitest'
import { userInfo } from 'node:os'
import { checkRemoval, realHomeDir } from '../../src/shared/removalGuard'

/**
 * `chore-uninstall-path`. The command deletes directories, and the obvious way
 * to test a deleter is to point it at a sandbox — which on macOS is the one
 * thing that does not work by itself: `os.homedir()` follows `HOME` and
 * `app.getPath()` does not, so a run under a `HOME`-only sandbox writes to the
 * real profile while every Node-side check reports the sandbox clean.
 *
 * **Measured, because the whole guard rests on it:** with `HOME=/tmp/fake-home`,
 * a child process reports `os.homedir()` as `/tmp/fake-home` and
 * `os.userInfo().homedir` as the real `/Users/…`. The passwd entry is not
 * movable by the environment, so that is the home this guard protects. A guard
 * written against `os.homedir()` would be defeated by exactly the trick it
 * exists to survive.
 */
const HOME = '/Users/someone'
const SANDBOX = '/tmp/obsrv-uninstall-test'
const opts = { realHome: HOME, sandboxRoot: SANDBOX }

describe('realHomeDir', () => {
  it('reads the passwd entry, which HOME cannot move', () => {
    expect(realHomeDir()).toBe(userInfo().homedir)
  })

  /**
   * The one that matters. Everything else here is arithmetic on strings; this
   * is the scenario the guard exists for, played out — a test harness has
   * pointed `HOME` at a sandbox, and the question is whether the guard still
   * knows where the user's real profile is.
   *
   * A guard written against `os.homedir()` passes every other test in this
   * file and fails this one.
   */
  it('still protects the real home when HOME has been pointed at a sandbox', () => {
    const before = process.env.HOME
    try {
      process.env.HOME = '/tmp/obsrv-pretend-home'
      const real = userInfo().homedir
      expect(realHomeDir(), 'HOME moved the guard’s idea of home').toBe(real)
      const v = checkRemoval(`${real}/Library/Application Support/Obsrv`)
      expect(v.allow, 'the guard allowed a removal inside the real profile while HOME pointed elsewhere').toBe(false)
      expect((v as { refuse: string }).refuse).toContain(real)
    } finally {
      if (before === undefined) delete process.env.HOME
      else process.env.HOME = before
    }
  })
})

describe('checkRemoval: the sandbox rules', () => {
  it('allows a path inside the declared sandbox', () => {
    expect(checkRemoval(`${SANDBOX}/Library/Application Support/Obsrv`, opts)).toMatchObject({ allow: true })
  })

  it('refuses a path outside the sandbox, even one that harms nothing', () => {
    const v = checkRemoval('/tmp/somewhere-else/Obsrv', opts)
    expect(v.allow).toBe(false)
    expect(v).toHaveProperty('refuse')
  })

  it('refuses a traversal that climbs out of the sandbox', () => {
    // The string starts with the sandbox root and does not stay there. A
    // prefix test alone would pass this, which is why the path is resolved
    // before it is judged.
    const v = checkRemoval(`${SANDBOX}/../../Users/someone/Library/Application Support/Obsrv`, opts)
    expect(v.allow).toBe(false)
    expect((v as { refuse: string }).refuse).toMatch(/real home|outside/)
  })

  it('refuses a sandbox that is itself inside the real home', () => {
    // The trap this card exists for: a "sandbox" under $HOME satisfies every
    // sandbox rule and is still his home.
    const v = checkRemoval(`${HOME}/tmp/sandbox/Obsrv`, { realHome: HOME, sandboxRoot: `${HOME}/tmp/sandbox` })
    expect(v.allow).toBe(false)
    expect((v as { refuse: string }).refuse).toContain('real home')
  })
})

describe('checkRemoval: the real home is refused whether or not a sandbox was declared', () => {
  it('refuses a path in the real home when no sandbox is declared', () => {
    const v = checkRemoval(`${HOME}/Library/Application Support/Obsrv`, { realHome: HOME })
    expect(v.allow).toBe(false)
    expect((v as { refuse: string }).refuse).toContain('real home')
  })

  it('refuses the real home itself', () => {
    expect(checkRemoval(HOME, { realHome: HOME }).allow).toBe(false)
  })

  it('refuses an ancestor of the real home', () => {
    // Removing /Users is not a subtle mistake, but a guard that only checks
    // "inside the home" would allow it.
    expect(checkRemoval('/Users', { realHome: HOME }).allow).toBe(false)
  })
})

describe('checkRemoval: paths nothing should ever remove', () => {
  it('refuses the root', () => {
    expect(checkRemoval('/', opts).allow).toBe(false)
  })

  it('refuses a path too shallow to be a data directory', () => {
    for (const p of ['/tmp', '/Users', '/Library']) {
      expect(checkRemoval(p, { realHome: HOME }).allow, `${p} should be refused`).toBe(false)
    }
  })

  it('refuses a relative path rather than resolving it against the process cwd', () => {
    // Where a relative path lands depends on who called, which is not a
    // property a deleter should have.
    const v = checkRemoval('Library/Application Support/Obsrv', opts)
    expect(v.allow).toBe(false)
    expect((v as { refuse: string }).refuse).toMatch(/absolute/)
  })

  it('refuses an empty target', () => {
    expect(checkRemoval('', opts).allow).toBe(false)
  })
})

describe('checkRemoval: what it reports', () => {
  it('returns the resolved path it judged, so a caller deletes what was checked', () => {
    // A caller that re-derives the path from the original string could delete
    // something the guard never saw.
    const v = checkRemoval(`${SANDBOX}/./Library/Obsrv`, opts)
    expect(v).toMatchObject({ allow: true, path: `${SANDBOX}/Library/Obsrv` })
  })

  it('names the real home in the refusal, because that is the fact the reader needs', () => {
    const v = checkRemoval(`${HOME}/Library/Logs/Obsrv`, { realHome: HOME })
    expect((v as { refuse: string }).refuse).toContain(HOME)
  })
})
