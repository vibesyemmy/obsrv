import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile } from '../../src/shared/control'
import { findPreset } from '../../src/shared/presets'

/**
 * `status` answers `presetId` and `orientation` from the renderer's mirror and
 * `cssWidth` / `cssHeight` from the offscreen surface. Run 19 saw the two
 * describe different moments at launch: a tab restored on `pixel-8` reported
 * `pixel-8` beside 1920x1080, so an agent reading the first reply clicked off
 * screen (`bug-drive-status-race-at-launch`). Every reply here is read from the
 * first moment the app answers, and each distinct state is recorded, so a red
 * says which pairing it saw and a green says what it watched.
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

type Status = { presetId?: string; orientation?: string; cssWidth?: number; cssHeight?: number }
type SavedTab = { url: string; presetId: string; profileId: string; orientation: 'portrait' | 'landscape' }

/** A preset's CSS size as the surface should render it: as stored, or a quarter turn. */
function sizeOf(presetId: string, orientation: string | undefined): { width: number; height: number } {
  const p = findPreset(presetId)
  return orientation === 'landscape' ? { width: p.height, height: p.width } : { width: p.width, height: p.height }
}

function status(port: number, token: string): Promise<Status | null> {
  return new Promise(done => {
    const req = request(
      { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          if (res.statusCode !== 200) return done(null)
          try {
            done(JSON.parse(text) as Status)
          } catch {
            done(null)
          }
        })
      },
    )
    req.on('error', () => done(null))
    req.end(JSON.stringify({ command: 'status', token }))
  })
}

async function launchAndRead(
  tabs: SavedTab[],
  activeIndex: number,
  env: Record<string, string> = {},
): Promise<{ replies: number; states: string[]; wrong: string[] }> {
  const home = mkdtempSync(join(tmpdir(), 'obsrv-e2e-'))
  writeFileSync(join(home, 'tabs.json'), JSON.stringify({ tabs, activeIndex }))
  const app = await launchApp([], { OBSRV_AGENT_CONTROL: '1', ...env }, home)
  try {
    const controlFile = join(home, CONTROL_FILE_NAME)
    await expect.poll(() => existsSync(controlFile), { timeout: 15_000 }).toBe(true)
    const info = parseControlFile(readFileSync(controlFile, 'utf8'))
    expect(info, 'the control file did not parse').not.toBeNull()
    if (!info || isDisabledStance(info)) throw new Error('the control file names no port: agent control is off')
    const states: string[] = []
    const wrong: string[] = []
    let replies = 0
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      const s = await status(info.port, info.token)
      if (!s) {
        await new Promise(r => setTimeout(r, 10))
        continue
      }
      replies++
      const state = `${s.presetId}/${s.orientation} ${s.cssWidth}x${s.cssHeight}`
      if (states[states.length - 1] !== state) states.push(state)
      // Zero is the documented "mid-recreation, did not say"; a non-zero size is
      // a claim, and it has to be the size of the preset the same reply names.
      if (s.presetId && (s.cssWidth ?? 0) > 0) {
        const want = sizeOf(s.presetId, s.orientation)
        if ((s.cssWidth !== want.width || s.cssHeight !== want.height) && wrong[wrong.length - 1] !== state) wrong.push(state)
      }
    }
    return { replies, states, wrong }
  } finally {
    await app.close()
  }
}

const saved = (presetId: string): SavedTab => ({ url: FIXTURE, presetId, profileId: 'reference', orientation: 'portrait' })

for (const { name, tabs, active, env } of [
  { name: 'one restored tab', tabs: [saved('pixel-8')], active: 0, env: {} },
  { name: 'three restored tabs, the active one last', tabs: [saved('laptop-768'), saved('1080p-24'), saved('pixel-8')], active: 2, env: {} },
  // The regression test proper. On a fast desk the renderer's first viewport
  // lands before the first control reply, so the two variants above passed 6 of
  // 6 against the bug; holding that viewport back in main (a test-only knob)
  // makes the launch window wide on purpose. Red on the code before the fix,
  // with the states `pixel-8/portrait 1920x1080 → pixel-8/portrait 412x915`.
  { name: 'the first viewport held back 1.5 s', tabs: [saved('pixel-8')], active: 0, env: { OBSRV_TEST_FIRST_VIEWPORT_DELAY_MS: '1500' } },
]) {
  test(`status after a launch describes one screen, not two moments — ${name}`, async () => {
    const { replies, states, wrong } = await launchAndRead(tabs, active, env)
    test.info().annotations.push({ type: 'states', description: `${replies} replies: ${states.join(' → ')}` })
    expect(replies, 'status never answered, so this test watched nothing').toBeGreaterThan(0)
    const restored = tabs[active]!
    const size = sizeOf(restored.presetId, restored.orientation)
    expect(states, 'the restored tab never appeared, so the restore was not exercised').toContain(
      `${restored.presetId}/${restored.orientation} ${size.width}x${size.height}`,
    )
    expect(wrong, `a reply named one preset at another's size; every state seen: ${states.join(' → ')}`).toEqual([])
  })
}
