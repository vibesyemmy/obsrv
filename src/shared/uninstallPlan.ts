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

import type { ConfirmKind } from './storedShapes'

export interface Removal {
  path: string
  /** What is in it, for a person about to delete it. */
  what: string
  /**
   * What must be true of the file's **content** before it may be claimed as
   * Obsrv's, for files in a directory Obsrv does not own.
   *
   * Raised by Henry on `#197`, and it caught an inconsistency in this file's
   * own reasoning: the Chromium state in the shared `Electron` directory is
   * left alone because it cannot be attributed — but `settings.json`,
   * `history.json` and `tabs.json` are **generic names**, and another unnamed
   * Electron app could write exactly those. Claiming them on the name alone is
   * the same attribution guess, made twice and refused once.
   *
   * So those three carry a check and the command must apply it before removing
   * them: if the file does not parse as Obsrv's own, it is named and kept.
   * `control.json` and `obsrv.log` are distinctive enough to claim by name.
   */
  confirm?: string

  /**
   * Which check `confirm` describes, for the command that must apply it.
   * `confirm` is the sentence a reader sees; this is what the remover runs.
   * They are separate so the prose can explain and the code can decide — and
   * so a file that carries prose but no check cannot quietly be removed on the
   * strength of the prose alone, which is the bug this pair exists for
   * (`bug-uninstall-confirm-unenforced`).
   */
  confirmWith?: ConfirmKind
}

export interface Kept {
  path: string
  /** Why the command will not remove it. Every entry has one. */
  why: string
}

export interface UninstallPlan {
  remove: Removal[]
  /**
   * Individual files to remove from directories that must themselves survive.
   *
   * This exists for one measured case and it is the sharpest form of this
   * card's privacy gap. Until `#201`, an app the MCP server launched from the
   * npm package — no `Obsrv.app` installed, so `electron out/main/index.js` —
   * **named itself "Electron"** (measured on CI, run `35168639669`), and wrote
   * its profile to `~/Library/Application Support/Electron` and its log to
   * `~/Library/Logs/Electron`. Every other unnamed Electron app on the machine
   * uses those same directories.
   *
   * So `history.json` — the file `bug-history-survives-uninstall` exists for —
   * can be sitting somewhere no uninstaller may `rm -rf` and the README's
   * removal list does not mention. Obsrv's own four files are named and
   * removed; the directory is not.
   */
  removeFiles: Removal[]
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
      removeFiles: [],
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

  // The legacy "Electron"-named profile. Named files only: the directory is
  // shared with every other unnamed Electron app, so removing it would take
  // someone else's data, and leaving `history.json` in it would leave the exact
  // file this card family exists for.
  const legacyUserData = `${home}/Library/Application Support/Electron`
  const legacyLogs = `${home}/Library/Logs/Electron`
  const removeFiles: Removal[] = [
    {
      path: `${legacyUserData}/history.json`,
      what: 'browsing history from an npm-only install that used live MCP before the app was named',
      confirm: "parses with Obsrv's history reader",
      confirmWith: 'history',
    },
    { path: `${legacyUserData}/settings.json`, what: 'settings from that same install', confirm: 'parses with `parseSettings`', confirmWith: 'settings' },
    { path: `${legacyUserData}/tabs.json`, what: 'open tabs from that same install', confirm: "parses with Obsrv's tab-list reader", confirmWith: 'tabs' },
    { path: `${legacyUserData}/control.json`, what: "the agent-control discovery file, which may name a port and token from a crashed run" },
    { path: `${legacyLogs}/obsrv.log`, what: 'the log from that same install' },
  ]

  const keep: Kept[] = [
    {
      path: legacyUserData,
      why:
        'Obsrv wrote here only because an app launched from the npm package used to name itself "Electron" (fixed by #201). ' +
        'Every other unnamed Electron app shares this directory, so it is never removed — only Obsrv’s own four files inside it are. ' +
        'The Chromium state beneath it (Cache, Local Storage) cannot be attributed to one app and is left by hand.',
    },
    {
      path: legacyLogs,
      why: 'the same shared name, for logs. `obsrv.log` inside it is removed; the directory and anything else in it are not.',
    },
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
    removeFiles,
    keep,
    unmeasured: false,
    note: 'Quit Obsrv before removing its profile: a running instance is still writing to it.',
  }
}
