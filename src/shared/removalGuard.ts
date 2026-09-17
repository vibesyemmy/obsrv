import { realpathSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

/**
 * The check that stands between `obsrv uninstall` and someone's home directory.
 *
 * It exists because the obvious way to test a deleter — point it at a sandbox —
 * is the one thing that does not work by itself on macOS. `os.homedir()`
 * follows `HOME`; `app.getPath()` does not. So a run under a `HOME`-only
 * sandbox writes to the **real** profile while every Node-side check reports
 * the sandbox clean, and a test that deletes gets a green tick and takes the
 * user's browsing history with it.
 *
 * Measured, because everything here rests on it: with `HOME=/tmp/fake-home`, a
 * child process reports `os.homedir()` as `/tmp/fake-home` and
 * `os.userInfo().homedir` as the real `/Users/…`. **The passwd entry is not
 * movable by the environment**, so that is the home this guard protects — a
 * guard written against `os.homedir()` would be defeated by exactly the trick
 * it exists to survive.
 *
 * Deliberately pure: it takes strings and returns a verdict, touches no
 * filesystem and removes nothing. What it cannot see is stated at `checkRemoval`.
 */

/** The home directory from the passwd entry, which `HOME` cannot move. */
export function realHomeDir(): string {
  return userInfo().homedir
}

export interface GuardOptions {
  /** The home to protect. Defaults to the passwd entry; pass one only in tests. */
  realHome?: string | undefined
  /**
   * When given, every removal must resolve inside this root — and the root
   * itself must lie outside the real home, or it is not a sandbox.
   */
  sandboxRoot?: string | undefined
  /**
   * Canonicalises a path: resolves symlinks and returns the filesystem's own
   * case. Defaults to `fs.realpathSync.native`; injected by tests so their arms
   * do not depend on one machine's layout.
   */
  realpath?: ((p: string) => string) | undefined
}

/**
 * The filesystem's own spelling of a path, for a path that may not exist.
 *
 * `realpath` throws on an absent path, and an uninstaller's targets are absent
 * exactly when it has already run. So the longest existing ancestor is
 * canonicalised and the remainder re-joined — which is enough, because what
 * matters here is which volume and which directory a path is *under*, and that
 * is decided by the part that exists.
 */
function canonical(p: string, rp: (s: string) => string): string {
  let head = p
  const tail: string[] = []
  for (;;) {
    try {
      const resolved = rp(head)
      return tail.length === 0 ? resolved : join(resolved, ...tail)
    } catch {
      const parent = dirname(head)
      // Nothing along the path exists: judge the literal path rather than
      // silently treating an unresolvable one as safe.
      if (parent === head) return p
      tail.unshift(basename(head))
      head = parent
    }
  }
}

export type GuardVerdict = { allow: true; path: string } | { allow: false; refuse: string }

/** Path depth below the root: `/tmp` is 1, `/tmp/a` is 2. */
function depth(p: string): number {
  return p.split(sep).filter(s => s !== '').length
}

/** `child` is `parent` or lies inside it, compared on resolved paths. */
function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * Judges one path a caller is about to remove.
 *
 * **Symlinks: handled where they exist, and NOT where they dangle.** A live
 * link is followed by `realpath`, so a sandbox root pointing into the real home
 * is refused. A **dangling** one is not: `realpath` throws on it, `canonical`
 * falls back to re-joining the unresolved segments literally, and
 * `<sandbox>/link/x` is allowed even when `link` points at a path under the
 * real home that does not exist yet. Should that target appear before the
 * removal runs, a deleter that follows links walks straight into the home.
 *
 * **So the caller's duty stands, and it is not weakened by the above:** anything
 * that removes directories must `lstat` and refuse to descend into symlinks
 * itself. This function narrows the hole; it does not close it. (Noted by Wren
 * on #197, after the live-symlink case was fixed — the danger of fixing half of
 * something is a comment that reads as though you fixed all of it.)
 */
export function checkRemoval(target: string, options: GuardOptions = {}): GuardVerdict {
  const rp = options.realpath ?? realpathSync.native
  const home = canonical(options.realHome ?? realHomeDir(), rp)
  const sandbox = options.sandboxRoot

  if (target.trim() === '') return { allow: false, refuse: 'refusing to remove an empty path.' }
  if (!isAbsolute(target)) {
    return {
      allow: false,
      refuse: `refusing to remove a relative path (${JSON.stringify(target)}): where it lands depends on the working directory of whoever called. Pass an absolute path.`,
    }
  }

  // Resolved AND canonicalised before anything is judged. `resolve` alone
  // handles `<sandbox>/../../Users/...`; it does not handle the two mismatches
  // Wren's cold read found, both of which let a path into the real home past a
  // string prefix:
  //   - case. A default APFS volume is case-insensitive, so
  //     `/users/someone/…` IS the real home and does not start with
  //     `/Users/someone/`. Measured on this machine, not reasoned.
  //   - symlinks. A sandbox root that is a link into the home is outside it as
  //     a string and inside it on disk.
  // `realpath` closes both: it follows links and returns the filesystem's own
  // case.
  const path = canonical(resolve(target), rp)

  // Both spellings, because canonicalising can make a shallow path look deep:
  // `/tmp` is one segment and resolves to `/private/tmp`, which is two. Judging
  // only the canonical form would let `obsrv uninstall /tmp` through.
  const asked = resolve(target)
  for (const p of [asked, path]) {
    if (depth(p) < 2) {
      return { allow: false, refuse: `refusing to remove ${p}: nothing this shallow is an application's data directory.` }
    }
  }

  // The real home first, and whether or not a sandbox was declared — a sandbox
  // that sits inside the home is not a sandbox, and that is the exact mistake
  // this card was claimed to prevent.
  if (within(home, path)) {
    return { allow: false, refuse: `refusing to remove ${path}: it is the real home (${home}) or an ancestor of it.` }
  }
  if (within(path, home)) {
    return {
      allow: false,
      refuse:
        `refusing to remove ${path}: it is inside the real home (${home}). ` +
        `A sandbox has to lie outside it — HOME does not move \`app.getPath()\` on macOS, so a path under the real home is the real thing however the environment is set.`,
    }
  }

  if (sandbox !== undefined) {
    const root = canonical(resolve(sandbox), rp)
    if (within(root, home) || within(home, root)) {
      return { allow: false, refuse: `refusing to use ${root} as a sandbox: it is inside the real home (${home}), so nothing removed under it would be sandboxed.` }
    }
    if (!within(path, root)) {
      return { allow: false, refuse: `refusing to remove ${path}: it is outside the sandbox root ${root}.` }
    }
  }

  return { allow: true, path }
}
