import { describe, expect, it } from 'vitest'
import { checkRemoval } from '../../src/shared/removalGuard'
import { uninstallPlan } from '../../src/shared/uninstallPlan'

/**
 * `chore-uninstall-path`. The plan is what the command would remove, as data —
 * no filesystem, nothing deleted. That makes the decisions reviewable before
 * any code acts on them, and it is the specification the command has to
 * satisfy.
 *
 * The inventory it encodes is measured, not reasoned: `a4`'s write-up
 * (`docs/research/2026-09-14-a4-install-remains.md`), taken on a packaged build
 * in a disposable home. Two of its findings matter here and are asserted below
 * rather than left in prose — `~/.obsrv` does not exist and never did, and two
 * of the directories a naive uninstaller would sweep are not Obsrv's to remove.
 */
const HOME = '/tmp/sandbox-home'
const plan = () => uninstallPlan({ home: HOME, platform: 'darwin' })

const removedPaths = (): string[] => plan().remove.map(r => r.path)
const keptPaths = (): string[] => plan().keep.map(k => k.path)

describe('what the plan removes', () => {
  it("names the app's own two directories, which is where everything private lives", () => {
    expect(removedPaths()).toContain(`${HOME}/Library/Application Support/Obsrv`)
    expect(removedPaths()).toContain(`${HOME}/Library/Logs/Obsrv`)
  })

  it('says what is in each, because a person deleting 1.3 GB deserves to know what it was', () => {
    const userData = plan().remove.find(r => r.path.endsWith('Application Support/Obsrv'))
    expect(userData?.what).toMatch(/history/i)
  })

  it('never names `~/.obsrv`, which a4 measured as not existing and nothing writing', () => {
    // The criterion and the card both pointed at it for weeks. A plan that
    // lists it would report success for removing nothing.
    expect(removedPaths().some(p => p.endsWith('/.obsrv'))).toBe(false)
  })
})

describe("what the plan refuses to remove, and says why", () => {
  it("leaves Electron's shared cache alone and names it", () => {
    const electron = `${HOME}/Library/Caches/electron`
    expect(removedPaths()).not.toContain(electron)
    const kept = plan().keep.find(k => k.path === electron)
    expect(kept, 'the shared cache must be named, not silently skipped').toBeDefined()
    expect(kept?.why).toMatch(/Electron|other app/i)
  })

  it("leaves the dev lane's own profile alone", () => {
    // `~/.obsrv-dev` is scripts/devLane.js's, not the app's — a developer's
    // second lane, and removing it on `obsrv uninstall` would be a surprise.
    const lane = `${HOME}/.obsrv-dev`
    expect(removedPaths()).not.toContain(lane)
    expect(plan().keep.some(k => k.path === lane)).toBe(true)
  })

  it('every kept path carries a reason, so the list cannot grow silently', () => {
    for (const k of plan().keep) expect(k.why.length, `${k.path} has no reason`).toBeGreaterThan(10)
  })
})

describe('the skill directory is offered, not assumed', () => {
  it('is not removed by default, because Obsrv put it somewhere that is not its own', () => {
    const skill = `${HOME}/.claude/skills/obsrv-screens`
    expect(removedPaths()).not.toContain(skill)
  })

  it('is removed when asked for, since `obsrv install-skill` is what created it', () => {
    const withSkill = uninstallPlan({ home: HOME, platform: 'darwin', includeSkill: true })
    expect(withSkill.remove.map(r => r.path)).toContain(`${HOME}/.claude/skills/obsrv-screens`)
  })
})

describe('the plan and the guard agree', () => {
  it('every path the plan would remove passes the removal guard against that sandbox', () => {
    // The two were written separately and must not drift: a plan naming a path
    // the guard refuses is a command that fails at the last step.
    for (const p of removedPaths()) {
      const v = checkRemoval(p, { realHome: '/Users/someone', sandboxRoot: HOME })
      expect(v.allow, `${p}: ${(v as { refuse?: string }).refuse ?? ''}`).toBe(true)
    }
  })

  it('and the guard still refuses the same plan aimed at a real home', () => {
    // The plan is home-relative, so pointing it at the real home is one
    // argument away. The guard is what stands between that and a deletion.
    const real = uninstallPlan({ home: '/Users/someone', platform: 'darwin' })
    for (const r of real.remove) {
      expect(checkRemoval(r.path, { realHome: '/Users/someone' }).allow, `${r.path} should be refused`).toBe(false)
    }
  })
})

/**
 * Measured by Henry on CI (run `35168639669`) and fixed forward by `#201`:
 * until that lands, an app the MCP server launched from the npm package — no
 * `Obsrv.app` installed, so `electron out/main/index.js` — **named itself
 * "Electron"**, and wrote its profile to `~/Library/Application Support/Electron`
 * and its log to `~/Library/Logs/Electron`.
 *
 * So an npm-only user who ever used live MCP has Obsrv's files, `history.json`
 * included, sitting in a directory **other unnamed Electron apps also use**.
 * That is this card family's privacy gap in its worst form: the file the whole
 * `bug-history-survives-uninstall` card was about, in a place the README's
 * removal list does not mention and no uninstaller may `rm -rf`.
 */
describe('the legacy "Electron" profile, which is shared and must not be swept', () => {
  const appSupport = `${HOME}/Library/Application Support/Electron`

  it('never removes the shared directory itself', () => {
    expect(removedPaths()).not.toContain(appSupport)
    expect(removedPaths()).not.toContain(`${HOME}/Library/Logs/Electron`)
  })

  it("removes Obsrv's own named files inside it, because that is where the history is", () => {
    const files = plan().removeFiles.map(f => f.path)
    expect(files).toContain(`${appSupport}/history.json`)
    expect(files).toContain(`${appSupport}/settings.json`)
    expect(files).toContain(`${appSupport}/tabs.json`)
    expect(files).toContain(`${appSupport}/control.json`)
    expect(files).toContain(`${HOME}/Library/Logs/Electron/obsrv.log`)
  })

  it('says the directory is shared, so a reader knows why only files are named', () => {
    const kept = plan().keep.find(k => k.path === appSupport)
    expect(kept, 'the shared directory must be named, not silently skipped').toBeDefined()
    expect(kept?.why).toMatch(/shared|other/i)
  })

  it('leaves the Chromium state in there alone, because it cannot be attributed', () => {
    // Two unnamed Electron apps writing one directory means the Cache and
    // Local Storage beneath it belong to whichever ran last. Removing them
    // would take another app's state; claiming they are Obsrv's would be a
    // guess. Named, not swept.
    const files = plan().removeFiles.map(f => f.path)
    expect(files.some(f => f.includes('/Electron/Cache'))).toBe(false)
    expect(plan().keep.find(k => k.path === appSupport)?.why).toMatch(/cannot|attribut|by hand/i)
  })

  it('will not claim a generically-named file on its name alone', () => {
    // Henry on #197, and it caught this file contradicting itself: the
    // Chromium state here is left alone because it cannot be attributed, while
    // settings/history/tabs were claimed on names another unnamed Electron app
    // could equally write. Same guess, made twice and refused once.
    const byName = Object.fromEntries(plan().removeFiles.map(f => [f.path.split('/').pop(), f]))
    for (const generic of ['history.json', 'settings.json', 'tabs.json']) {
      expect(byName[generic]?.confirm, `${generic} may not be claimed on its name`).toBeTruthy()
    }
  })

  it('claims the distinctive two by name, since no attribution guess is involved', () => {
    const byName = Object.fromEntries(plan().removeFiles.map(f => [f.path.split('/').pop(), f]))
    expect(byName['control.json']?.confirm).toBeUndefined()
    expect(byName['obsrv.log']?.confirm).toBeUndefined()
  })

  it('needs no such check for directories Obsrv owns outright', () => {
    for (const r of plan().remove) expect(r.confirm, `${r.path} is Obsrv's own directory`).toBeUndefined()
  })

  it('every file it would remove still passes the guard', () => {
    for (const f of plan().removeFiles) {
      const v = checkRemoval(f.path, { realHome: '/Users/someone', sandboxRoot: HOME })
      expect(v.allow, `${f.path}: ${(v as { refuse?: string }).refuse ?? ''}`).toBe(true)
    }
  })
})

describe('platforms it has not measured', () => {
  it('says so rather than guessing paths nobody has checked', () => {
    const win = uninstallPlan({ home: 'C:\\Users\\someone', platform: 'win32' })
    expect(win.remove).toHaveLength(0)
    expect(win.unmeasured).toBe(true)
    expect(win.note).toMatch(/macOS|not measured/i)
  })
})
