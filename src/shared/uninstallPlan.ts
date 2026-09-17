/**
 * What `obsrv uninstall` would remove, as data rather than as action.
 *
 * Pure: it takes a home and a platform and returns two lists. It touches no
 * filesystem and removes nothing, which is what lets the decisions below be
 * reviewed before any code acts on them — and it is the specification the
 * command has to satisfy.
 *
 * **The inventory is measured, not reasoned.** `docs/research/2026-09-14-a4-install-remains.md`
 * ran install → use → uninstall on a packaged build in a disposable home and
 * counted what remained. Two of its findings are load-bearing here:
 *
 * - **There is no `~/.obsrv`.** The readiness doc and the board card both named
 *   it for weeks; nothing in the source writes it, and it does not exist on a
 *   machine that has run Obsrv for weeks. A plan that listed it would report
 *   success for removing nothing — the empty list that fits two facts, sitting
 *   inside the check itself.
 * - **Two directories a naive sweep would take are not Obsrv's.**
 *   `~/Library/Caches/electron` belongs to Electron and is shared with every
 *   other Electron app on the machine; `~/.obsrv-dev` is the dev lane's own
 *   profile (`scripts/devLane.js`). Both are named in `keep` rather than
 *   silently skipped, because a list that omits them cannot be checked for
 *   having considered them.
 */

export interface Removal {
  path: string
  /** What is in it, for a person about to delete it. */
  what: string
}

export interface Kept {
  path: string
  /** Why the command will not remove it. Every entry has one. */
  why: string
}

export interface UninstallPlan {
  remove: Removal[]
  keep: Kept[]
  /** True when this platform's paths have not been measured, and `remove` is therefore empty. */
  unmeasured: boolean
  /** Said to the user whenever there is something the lists alone do not convey. */
  note: string | null
}

export interface PlanOptions {
  home: string
  platform: NodeJS.Platform
  /**
   * Remove `~/.claude/skills/obsrv-screens` too. Off by default: `obsrv
   * install-skill` created it, so it is Obsrv's doing, but it lives in another
   * tool's directory and a person may still want the skill after removing the
   * app.
   */
  includeSkill?: boolean | undefined
}

export function uninstallPlan({ home, platform, includeSkill = false }: PlanOptions): UninstallPlan {
  if (platform !== 'darwin') {
    return {
      remove: [],
      keep: [],
      unmeasured: true,
      note:
        `Obsrv's data locations have only been measured on macOS ` +
        `(docs/research/2026-09-14-a4-install-remains.md). Rather than guess at paths for ${platform} and ` +
        `report success for removing the wrong thing, this command removes nothing here.`,
    }
  }

  const remove: Removal[] = [
    {
      path: `${home}/Library/Application Support/Obsrv`,
      what: "settings, browsing history (history.json), open tabs, and Chromium's per-site state and caches",
    },
    { path: `${home}/Library/Logs/Obsrv`, what: 'obsrv.log' },
  ]
  if (includeSkill) {
    remove.push({ path: `${home}/.claude/skills/obsrv-screens`, what: 'the Claude skill `obsrv install-skill` wrote' })
  }

  const keep: Kept[] = [
    {
      path: `${home}/Library/Caches/electron`,
      why:
        "this is Electron's own cache, not Obsrv's, and every other Electron app on the machine shares it. " +
        'Removing it would delete another application’s runtime. Remove it by hand once you have checked nothing else needs it.',
    },
    {
      path: `${home}/.obsrv-dev`,
      why: "this is the dev lane's own profile (scripts/devLane.js), not the app's — a developer's second lane rather than anything this install wrote.",
    },
  ]
  if (!includeSkill) {
    keep.push({
      path: `${home}/.claude/skills/obsrv-screens`,
      why: '`obsrv install-skill` wrote this, but it lives in another tool’s directory and is useful without Obsrv installed. Pass --include-skill to remove it too.',
    })
  }

  return {
    remove,
    keep,
    unmeasured: false,
    note: 'Quit Obsrv before removing its profile: a running instance is still writing to it.',
  }
}
