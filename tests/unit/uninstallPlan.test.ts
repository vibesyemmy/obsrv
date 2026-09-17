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

describe('platforms it has not measured', () => {
  it('says so rather than guessing paths nobody has checked', () => {
    const win = uninstallPlan({ home: 'C:\\Users\\someone', platform: 'win32' })
    expect(win.remove).toHaveLength(0)
    expect(win.unmeasured).toBe(true)
    expect(win.note).toMatch(/macOS|not measured/i)
  })
})
