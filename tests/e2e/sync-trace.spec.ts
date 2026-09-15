import { expect, test, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'
import type { MirrorBranch, MirrorDecision } from '../../src/main/syncBus'

/**
 * The mirror trace, made to lie before it is believed.
 *
 * `mirror()` has five exits and every one of them looks the same from outside:
 * the other pane did not move. The trace exists so a failing run can say which
 * one it took — but a trace that has never been seen to print a given branch is
 * indistinguishable from a branch that cannot happen, and a missing line would
 * then read as evidence. So each branch is forced here on purpose and watched.
 *
 * Written for flake-sync-165, where the margin hypothesis died precisely
 * because a number that had never been read turned out to be a constant.
 */
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const LOOP = pathToFileURL(resolve(__dirname, '../fixtures/loop.html')).href

let app: ElectronApplication

test.beforeAll(async () => {
  app = await launchApp()
})
test.afterAll(async () => {
  await app.close()
})

const trace = (): Promise<MirrorDecision[]> =>
  app.evaluate(() => (globalThis as { __obsrv?: any }).__obsrv.sync.mirrorTrace().slice() as MirrorDecision[])

const branches = async (): Promise<MirrorBranch[]> => (await trace()).map(d => d.branch)

const load = async (pane: 'native' | 'target', url: string): Promise<void> => {
  await app.evaluate(async (_e, [p, u]: [string, string]) => {
    await (globalThis as any).__obsrv[p].load(u)
  }, [pane, url] as [string, string])
}

const urls = (a: ElectronApplication): Promise<{ native: string; target: string }> =>
  a.evaluate(() => {
    const g = globalThis as any
    return { native: g.__obsrv.native.webContents.getURL(), target: g.__obsrv.target.webContents.getURL() }
  })

test('a plain navigation records the mirror it issued, and the echo that came back', async () => {
  await load('native', TALL)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: TALL, target: TALL })

  const seen = await trace()
  const issued = seen.filter(d => d.branch === 'issued')
  expect(issued.length).toBeGreaterThan(0)
  expect(issued.at(-1)).toMatchObject({ from: 'native', url: TALL })
  // The mirrored load's own commit in the other pane is the echo. Without it
  // every mirror would bounce back and the panes would ping-pong forever.
  expect(seen.map(d => d.branch)).toContain('echo')
})

test('a pane already on the URL records already-there, with the URL it was already on', async () => {
  // The second load has to be in the pane the bus did NOT issue into, or its
  // commit is an echo and exits one branch earlier. Reloading the *source*
  // pane is not an echo — the bus never sent it anything — so the decision
  // runs on and finds the other pane already on the URL.
  await load('native', HAIRLINE)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: HAIRLINE, target: HAIRLINE })
  await load('native', HAIRLINE)

  await expect.poll(async () => (await branches()).includes('already-there'), { timeout: 5_000 }).toBe(true)
  const hit = (await trace()).filter(d => d.branch === 'already-there').at(-1)
  expect(hit?.detail).toBe(HAIRLINE)
})

test('the loop fixture records trip, and the trace says so rather than only the log', async () => {
  await load('native', LOOP)
  await expect.poll(async () => (await branches()).includes('trip'), { timeout: 10_000 }).toBe(true)

  const trip = (await trace()).filter(d => d.branch === 'trip').at(-1)
  expect(trip?.detail).toMatch(/alternations=\d+/)
  const state = await app.evaluate(() => (globalThis as any).__obsrv.sync.loopState())
  expect(state.trips).toBeGreaterThan(0)
})

/**
 * `pane-destroyed` is NOT forced here, and that is worth stating rather than
 * leaving as a gap in the list above.
 *
 * Destroying a pane mid-run is not something a spec can do to the live app
 * without tearing down the session the rest of the file shares — the panes
 * belong to the active `TabSession`, and a destroyed one is a tab that has
 * gone, not a pane sitting idle. So this branch has never been observed to
 * fire, and if it ever appears in a failure trace it should be treated as a
 * new fact rather than as a recognised state.
 *
 * The consequence for reading a trace: absence of `pane-destroyed` means
 * nothing. Absence of the other four means they did not happen.
 */
test('the branches this suite can force are exactly four of five, and it says which', async () => {
  const forced: MirrorBranch[] = ['issued', 'echo', 'already-there', 'trip']
  const all: MirrorBranch[] = ['issued', 'echo', 'already-there', 'trip', 'pane-destroyed']
  expect(all.filter(b => !forced.includes(b))).toEqual(['pane-destroyed'])
})
