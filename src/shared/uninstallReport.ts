import type { ConfirmKind } from './storedShapes'
import type { Kept, Removal, UninstallPlan } from './uninstallPlan'

/**
 * `obsrv uninstall`'s answer, as data and then as words.
 *
 * The plan (`uninstallPlan`) says what Obsrv's data locations ARE. This says
 * what is there **on this machine**, what the removal guard makes of each path,
 * and what a person can run to remove it. It is the listing half of the
 * command, and it is the half that needs no permission to exist: like the plan
 * and the guard, this module touches no filesystem and removes nothing. The
 * caller passes in what it found.
 *
 * **Why a listing command at all, when the README already carries the list.**
 * The README's list is three paths written by hand. This one is computed from
 * the same source the command will remove from, says which of them exist here,
 * and puts every path through `checkRemoval` before printing it — so a path the
 * guard would refuse is visible as a refusal rather than as a line in a list
 * that looks removable. A person copying `rm -rf` lines out of a README has no
 * such check.
 *
 * **What it deliberately does not do:** remove anything. The removal half waits
 * on its own decision, and a listing that quietly grew a `--force` would be the
 * change nobody reviewed.
 */

/** What the filesystem says about one path — as much as a listing needs. */
export interface Presence {
  exists: boolean
  /** Bytes underneath it, when the caller measured them. */
  bytes?: number | undefined
  /** True when the caller stopped counting before the end. */
  partial?: boolean | undefined
}

/** The removal guard's verdict, narrowed to what a listing prints. */
export type Verdict = { allow: true } | { allow: false; refuse: string }

export interface ReportInput {
  plan: UninstallPlan
  /** What is actually on disk. Injected, so this module reads nothing. */
  look: (path: string) => Presence
  /** `checkRemoval`, injected for the same reason. */
  check: (path: string) => Verdict
}

export interface ReportEntry {
  path: string
  what: string
  /** Set only for the legacy shared directories, where one file is claimed and the directory is not. */
  confirm?: string | undefined
  /** The check the remover must run before this file may be removed. */
  confirmWith?: ConfirmKind | undefined
  bytes?: number | undefined
  partial?: boolean | undefined
  /** Why the guard refused it, when it did. */
  refused?: string | undefined
}

export interface UninstallReport {
  /** Here, and the guard allows removing it. */
  present: ReportEntry[]
  /** Named by the plan, and not on this machine. */
  absent: ReportEntry[]
  /** Here, and the guard refuses. A refusal is a finding, never a silent omission. */
  refused: ReportEntry[]
  keep: Kept[]
  note: string | null
  unmeasured: boolean
  /** What a person can run to remove what is listed, in the order given. */
  commands: string[]
}

/** Bytes as a person reads them. Whole units below 10, one decimal above. */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const shown = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${shown} ${units[unit]}`
}

/** Single-quoted for a shell, which is what a person will paste it into. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

function entryOf(removal: Removal, look: (p: string) => Presence, check: (p: string) => Verdict): { entry: ReportEntry; where: 'present' | 'absent' | 'refused' } {
  const seen = look(removal.path)
  const entry: ReportEntry = { path: removal.path, what: removal.what }
  if (removal.confirm !== undefined) entry.confirm = removal.confirm
  if (removal.confirmWith !== undefined) entry.confirmWith = removal.confirmWith
  if (!seen.exists) return { entry, where: 'absent' }
  entry.bytes = seen.bytes
  entry.partial = seen.partial
  const verdict = check(removal.path)
  if (!verdict.allow) {
    entry.refused = verdict.refuse
    return { entry, where: 'refused' }
  }
  return { entry, where: 'present' }
}

export function uninstallReport({ plan, look, check }: ReportInput): UninstallReport {
  const present: ReportEntry[] = []
  const absent: ReportEntry[] = []
  const refused: ReportEntry[] = []
  for (const removal of [...plan.remove, ...plan.removeFiles]) {
    const { entry, where } = entryOf(removal, look, check)
    if (where === 'present') present.push(entry)
    else if (where === 'absent') absent.push(entry)
    else refused.push(entry)
  }
  // Only what is here, and only what the guard allows: a command for a path
  // that is not there reports success for removing nothing, and a command for
  // a path the guard refused would hand the person the very thing the guard
  // exists to stop.
  const commands = present.map(e => `rm -rf ${shellQuote(e.path)}`)
  return { present, absent, refused, keep: plan.keep, note: plan.note, unmeasured: plan.unmeasured, commands }
}

/**
 * The report as the words a person reads. Kept beside the data so the two
 * cannot drift, and pure for the same reason the rest of this file is.
 */
export function uninstallLines(report: UninstallReport, opts: { removing?: boolean } = {}): string[] {
  const lines: string[] = []
  if (report.unmeasured) {
    lines.push(report.note ?? 'Obsrv has nothing measured to remove on this platform.')
    return lines
  }
  if (report.present.length === 0 && report.refused.length === 0) {
    lines.push("Nothing of Obsrv's is on this machine: every path it writes is already gone.")
  } else {
    lines.push('Obsrv wrote these, and they are still here:')
    for (const e of report.present) {
      const size = e.bytes === undefined ? '' : ` — ${humanBytes(e.bytes)}${e.partial === true ? '+' : ''}`
      lines.push(`  ${e.path}${size}`)
      lines.push(`      ${e.what}`)
      if (e.confirm !== undefined) lines.push(`      claimed only if it ${e.confirm}`)
    }
  }
  if (report.absent.length > 0) {
    lines.push('')
    lines.push('Named by the plan and not on this machine:')
    for (const e of report.absent) lines.push(`  ${e.path}`)
  }
  if (report.refused.length > 0) {
    lines.push('')
    lines.push('Here, and refused by the removal guard — read the reason before you touch them:')
    for (const e of report.refused) {
      lines.push(`  ${e.path}`)
      lines.push(`      ${e.refused ?? 'refused'}`)
    }
  }
  if (report.keep.length > 0) {
    lines.push('')
    lines.push('Left alone, and why:')
    for (const k of report.keep) {
      lines.push(`  ${k.path}`)
      lines.push(`      ${k.why}`)
    }
  }
  if (report.note !== null) {
    lines.push('')
    lines.push(report.note)
  }
  lines.push('')
  // The closing line is the one a person acts on, so it has to describe THIS
  // run. Under `--remove` the same listing is printed first and then the paths
  // go, and a line reading "nothing has been removed" above a removal would be
  // false by the time they finished reading it.
  if (opts.removing === true) {
    if (report.commands.length > 0) lines.push('Removing the above now, each path re-checked against the removal guard as it goes.')
    else lines.push('Nothing here to remove.')
  } else if (report.commands.length > 0) {
    // The command lists; it does not remove. Saying so once, plainly, beats a
    // reader inferring it from the absence of a flag.
    lines.push('This command lists only — nothing has been removed. To remove what is above, pass --remove, or run:')
    for (const c of report.commands) lines.push(`  ${c}`)
  } else {
    lines.push('This command lists only — nothing has been removed, and there is nothing here to remove.')
  }
  return lines
}
