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

/**
 * Found by Wren's cold read of #197, and confirmed on this machine before being
 * fixed: `/users/opeyemiajagbe` **exists** on a default APFS volume, and
 * `'/users/…'.startsWith('/Users/opeyemiajagbe/')` is `false`. So the guard's
 * central claim — that a path inside the real home is refused whether or not a
 * sandbox was declared — was not true as written. The same mismatch let a
 * sandbox root typed in another case, or one that is a symlink into the home,
 * past the check that exists to catch exactly that.
 *
 * `fs.realpathSync.native` closes both at once: it resolves symlinks and
 * returns the filesystem's own case. Injected here so these arms do not depend
 * on a particular machine's layout, with one arm that uses the real one.
 */
describe('checkRemoval: canonical paths, not string prefixes', () => {
  const HOME_REAL = '/Users/someone'
  // A stand-in for the filesystem: lowercases the volume's case back to
  // canonical, and resolves two symlinks.
  const links: Record<string, string> = {
    '/tmp': '/private/tmp',
    '/tmp/box-into-home': `${HOME_REAL}/secretly`,
  }
  const fakeRealpath = (p: string): string => {
    // Longest key first: a real filesystem resolves the most specific link on
    // the path, and matching `/tmp` before `/tmp/box-into-home` made this fake
    // hide the very case it was written for.
    for (const [from, to] of Object.entries(links).sort((a, b) => b[0].length - a[0].length)) {
      if (p === from || p.startsWith(from + '/')) return to + p.slice(from.length)
    }
    if (p.toLowerCase().startsWith('/users/')) return '/Users/' + p.slice('/users/'.length)
    return p
  }

  it('refuses the real home reached through a different case', () => {
    const v = checkRemoval('/users/someone/Library/Application Support/Obsrv', { realHome: HOME_REAL, realpath: fakeRealpath })
    expect(v.allow, 'a lowercase path to the real home was allowed').toBe(false)
    expect((v as { refuse: string }).refuse).toContain('real home')
  })

  it('refuses a sandbox root that is a symlink into the real home', () => {
    // Outside the home as a string, inside it on disk. This is the one that
    // would have deleted a profile while every rule here read green.
    const v = checkRemoval('/tmp/box-into-home/Obsrv', { realHome: HOME_REAL, sandboxRoot: '/tmp/box-into-home', realpath: fakeRealpath })
    expect(v.allow, 'a sandbox symlinked into the real home was allowed').toBe(false)
    expect((v as { refuse: string }).refuse).toContain('real home')
  })

  it('still allows a genuine sandbox whose root only differs by /tmp → /private/tmp', () => {
    // The benign version of the same mismatch: both sides canonicalise, so it
    // must not become a refusal.
    const v = checkRemoval('/tmp/obsrv-box/Library/Obsrv', { realHome: HOME_REAL, sandboxRoot: '/tmp/obsrv-box', realpath: fakeRealpath })
    expect(v.allow, (v as { refuse?: string }).refuse ?? '').toBe(true)
    expect((v as { allow: true; path: string }).path).toBe('/private/tmp/obsrv-box/Library/Obsrv')
  })

  it('judges a path that does not exist yet, by canonicalising as far as it can', () => {
    // A target may be absent — that is the ordinary case after a first
    // uninstall — and `realpath` throws on it. The guard must still judge it.
    const throwing = (p: string): string => {
      if (p.includes('not-created-yet')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return fakeRealpath(p)
    }
    const v = checkRemoval('/users/someone/not-created-yet/Obsrv', { realHome: HOME_REAL, realpath: throwing })
    expect(v.allow, 'an absent path under the real home was allowed').toBe(false)
  })

  it('does NOT catch a dangling symlink, and this test exists so that is known rather than discovered', () => {
    // Wren's note on #197, after the live-symlink case was fixed. `realpath`
    // throws on a link whose target does not exist, `canonical` falls back to
    // re-joining literally, and the verdict allows a path under a link that
    // points into the real home. If that target appears before the removal
    // runs, a deleter following links walks into the home.
    //
    // Asserted as-is rather than fixed: closing it needs `lstat` on every
    // segment, which is the caller's duty anyway for the directory walk. The
    // danger of fixing half a problem is believing you fixed all of it, so the
    // remaining half is written down and tested.
    const dangling = (p: string): string => {
      if (p === '/tmp/box/link' || p.startsWith('/tmp/box/link/')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return p
    }
    const v = checkRemoval('/tmp/box/link/Obsrv', { realHome: HOME_REAL, sandboxRoot: '/tmp/box', realpath: dangling })
    expect(v.allow, 'if this now refuses, the guard got stronger and this test should say so').toBe(true)
  })

  it('uses the real filesystem by default', () => {
    // The arms above inject, so one arm must show the default is wired up.
    // `/tmp` resolving to `/private/tmp` is the cheapest true statement about
    // this machine that does not depend on anyone's home.
    const v = checkRemoval('/tmp/obsrv-guard-default-check/x', { realHome: '/Users/nobody-at-all', sandboxRoot: '/tmp/obsrv-guard-default-check' })
    expect(v).toMatchObject({ allow: true, path: '/private/tmp/obsrv-guard-default-check/x' })
  })
})

describe('checkRemoval: what it reports', () => {
  it('returns the CANONICAL path it judged, so a caller deletes what was checked', () => {
    // A caller that re-derives the path from the original string could delete
    // something the guard never saw — and after the case/symlink fix the path
    // judged is the canonical one, which on this machine means `/tmp` comes
    // back as `/private/tmp`. That difference is the point: the caller must
    // remove what was checked, not what was asked for.
    const v = checkRemoval(`${SANDBOX}/./Library/Obsrv`, opts)
    expect(v).toMatchObject({ allow: true, path: `/private${SANDBOX}/Library/Obsrv` })
  })

  it('names the real home in the refusal, because that is the fact the reader needs', () => {
    const v = checkRemoval(`${HOME}/Library/Logs/Obsrv`, { realHome: HOME })
    expect((v as { refuse: string }).refuse).toContain(HOME)
  })
})
