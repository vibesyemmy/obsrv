import { describe, expect, it } from 'vitest'
import { uninstallPlan } from '../../src/shared/uninstallPlan'
import { humanBytes, uninstallLines, uninstallReport, type Presence, type Verdict } from '../../src/shared/uninstallReport'

/**
 * The listing half of `obsrv uninstall`, tested with **no filesystem at all**.
 *
 * That is not a convenience. An uninstaller's tests are the one place where
 * getting the sandbox wrong deletes someone's history, so the parts that can be
 * pure are pure and the parts that cannot are kept to one thin shell
 * (`bin/uninstall.js`). Here the filesystem and the guard are both injected,
 * and nothing under any home is read.
 */

const HOME = '/Users/someone'
const plan = uninstallPlan({ home: HOME, platform: 'darwin' })
const allow = (): Verdict => ({ allow: true })
const here = (paths: string[]) => (path: string): Presence => (paths.includes(path) ? { exists: true, bytes: 1024 } : { exists: false })

describe('uninstallReport', () => {
  it('splits what is here from what the plan merely names', () => {
    const profile = `${HOME}/Library/Application Support/Obsrv`
    const r = uninstallReport({ plan, look: here([profile]), check: allow })
    expect(r.present.map(e => e.path)).toEqual([profile])
    expect(r.absent.map(e => e.path)).toContain(`${HOME}/Library/Logs/Obsrv`)
    expect(r.refused).toEqual([])
  })

  it('offers a command for what is here, and for nothing else', () => {
    const profile = `${HOME}/Library/Application Support/Obsrv`
    const r = uninstallReport({ plan, look: here([profile]), check: allow })
    // A command for an absent path reports success for removing nothing — the
    // empty success this whole card family exists to refuse.
    expect(r.commands).toEqual([`rm -rf '${profile}'`])
  })

  it("surfaces the guard's refusal instead of listing the path as removable", () => {
    const profile = `${HOME}/Library/Application Support/Obsrv`
    const refuse = (path: string): Verdict => (path === profile ? { allow: false, refuse: 'resolves inside the real home' } : { allow: true })
    const r = uninstallReport({ plan, look: here([profile]), check: refuse })
    expect(r.present).toEqual([])
    expect(r.refused.map(e => e.path)).toEqual([profile])
    expect(r.refused[0]?.refused).toBe('resolves inside the real home')
    // And a refused path is never in the commands: handing it to a person to
    // paste is exactly what the guard exists to stop.
    expect(r.commands).toEqual([])
  })

  it('carries the legacy files with the check that has to pass before they are claimed', () => {
    const legacy = `${HOME}/Library/Application Support/Electron/history.json`
    const r = uninstallReport({ plan, look: here([legacy]), check: allow })
    expect(r.present.map(e => e.path)).toEqual([legacy])
    expect(r.present[0]?.confirm).toBe("parses with Obsrv's history reader")
  })

  it('keeps the plan’s keep list, which is the part a reader checks for having been considered', () => {
    const r = uninstallReport({ plan, look: here([]), check: allow })
    expect(r.keep.map(k => k.path)).toContain(`${HOME}/Library/Caches/electron`)
    expect(r.keep.every(k => k.why.length > 0)).toBe(true)
  })

  it('says nothing is removable on a platform nobody measured', () => {
    const windows = uninstallPlan({ home: 'C:/Users/someone', platform: 'win32' })
    const r = uninstallReport({ plan: windows, look: here([]), check: allow })
    expect(r.unmeasured).toBe(true)
    expect(r.commands).toEqual([])
    expect(uninstallLines(r).join('\n')).toMatch(/only been measured on macOS/)
  })
})

describe('the words', () => {
  const profile = `${HOME}/Library/Application Support/Obsrv`

  it('says it removed nothing, whether or not anything is there', () => {
    const withData = uninstallLines(uninstallReport({ plan, look: here([profile]), check: allow })).join('\n')
    const without = uninstallLines(uninstallReport({ plan, look: here([]), check: allow })).join('\n')
    // The absence of a `--force` flag is not a sentence. Both readings say it.
    expect(withData).toContain('This command lists only — nothing has been removed')
    expect(without).toContain('nothing has been removed, and there is nothing here to remove')
    expect(without).toContain("Nothing of Obsrv's is on this machine")
  })

  it('prints a refusal with its reason, under a heading that says to read it', () => {
    const refuse = (path: string): Verdict => (path === profile ? { allow: false, refuse: 'resolves inside the real home' } : { allow: true })
    const said = uninstallLines(uninstallReport({ plan, look: here([profile]), check: refuse })).join('\n')
    expect(said).toContain('refused by the removal guard')
    expect(said).toContain('resolves inside the real home')
    expect(said).not.toContain(`rm -rf '${profile}'`)
  })

  it('does not say "nothing has been removed" when a removal is about to happen', () => {
    // The closing line is the one a person acts on. `--remove` prints this same
    // listing first and then deletes, so the listing has to describe THIS run:
    // a "nothing has been removed" above a removal is false by the time they
    // have finished reading it.
    const listing = uninstallLines(uninstallReport({ plan, look: here([profile]), check: allow })).join('\n')
    const removing = uninstallLines(uninstallReport({ plan, look: here([profile]), check: allow }), { removing: true }).join('\n')
    expect(listing).toContain('This command lists only — nothing has been removed')
    expect(removing).not.toContain('nothing has been removed')
    expect(removing).toContain('Removing the above now, each path re-checked against the removal guard as it goes.')
    // And with nothing there, it says that rather than promising a removal.
    const empty = uninstallLines(uninstallReport({ plan, look: here([]), check: allow }), { removing: true }).join('\n')
    expect(empty).toContain('Nothing here to remove.')
  })

  it('names what is left alone and why, rather than leaving it out', () => {
    const said = uninstallLines(uninstallReport({ plan, look: here([]), check: allow })).join('\n')
    expect(said).toContain('Left alone, and why:')
    expect(said).toContain(`${HOME}/Library/Caches/electron`)
    expect(said).toContain("Electron's own cache")
  })
})

describe('humanBytes', () => {
  it('reads as a person reads a size', () => {
    expect(humanBytes(0)).toBe('0 B')
    expect(humanBytes(999)).toBe('999 B')
    expect(humanBytes(1024)).toBe('1 KB')
    expect(humanBytes(1536)).toBe('1.5 KB')
    expect(humanBytes(1_395_864_371)).toBe('1.3 GB')
  })
  it('answers `?` rather than a number for what was never measured', () => {
    expect(humanBytes(Number.NaN)).toBe('?')
    expect(humanBytes(-1)).toBe('?')
  })
})

/**
 * The guarantee the command's name makes — **it removes nothing** — proven
 * where it can be proven by construction rather than by a process that has to
 * run somewhere safe (Wren's read of #298). The report can only reach the
 * world through `look` and `check`; a recorder in both shows exactly which
 * paths it asked about, and that asking is all it did.
 */
describe('what the report is able to do at all', () => {
  it('reads only through what it was given, and hands removal to the caller as text', () => {
    const asked: { look: string[]; check: string[] } = { look: [], check: [] }
    const r = uninstallReport({
      plan,
      look: path => {
        asked.look.push(path)
        return { exists: true, bytes: 8 }
      },
      check: path => {
        asked.check.push(path)
        return { allow: true }
      },
    })
    // Every path it touched is one the plan named: it invents none.
    const planned = [...plan.remove, ...plan.removeFiles].map(e => e.path)
    expect(asked.look).toEqual(planned)
    expect(asked.check).toEqual(planned)
    // And what it produces for removal is a list of strings for a person to
    // run, never a call it made itself.
    expect(r.commands.every(c => typeof c === 'string' && c.startsWith('rm -rf '))).toBe(true)
    expect(r.commands).toHaveLength(planned.length)
  })
})

