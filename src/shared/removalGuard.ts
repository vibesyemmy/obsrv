import { userInfo } from 'node:os'
import { isAbsolute, resolve, sep } from 'node:path'

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
 * **What it cannot see, and a caller must not assume it can:** symlinks. These
 * are string comparisons on resolved paths, so a sandbox containing a symlink
 * to somewhere under the real home satisfies every rule here. A caller that
 * removes directories should refuse to follow symlinks itself (`lstat` before
 * descending) rather than expect this to have caught it.
 */
export function checkRemoval(target: string, options: GuardOptions = {}): GuardVerdict {
  const home = options.realHome ?? realHomeDir()
  const sandbox = options.sandboxRoot

  if (target.trim() === '') return { allow: false, refuse: 'refusing to remove an empty path.' }
  if (!isAbsolute(target)) {
    return {
      allow: false,
      refuse: `refusing to remove a relative path (${JSON.stringify(target)}): where it lands depends on the working directory of whoever called. Pass an absolute path.`,
    }
  }

  // Resolved before anything is judged: a prefix test against an unresolved
  // path passes `<sandbox>/../../Users/...`, which is the traversal that makes
  // this whole guard worth having.
  const path = resolve(target)

  if (depth(path) < 2) {
    return { allow: false, refuse: `refusing to remove ${path}: nothing this shallow is an application's data directory.` }
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
    const root = resolve(sandbox)
    if (within(root, home) || within(home, root)) {
      return { allow: false, refuse: `refusing to use ${root} as a sandbox: it is inside the real home (${home}), so nothing removed under it would be sandboxed.` }
    }
    if (!within(path, root)) {
      return { allow: false, refuse: `refusing to remove ${path}: it is outside the sandbox root ${root}.` }
    }
  }

  return { allow: true, path }
}
