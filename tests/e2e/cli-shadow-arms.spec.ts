import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `feat-measure-open-shadow-roots`, step one: the acceptance arms, written to
 * FAIL on current main and kept on this branch until implementation starts
 * (Henry, #388 — not `test.fail()`, which passes on any failure and would stay
 * green in a gating suite whether or not an arm still checked anything).
 *
 * Every red arm has a light-DOM twin in this file that is green today, against
 * `shadow-arms-flat.html`: the same markup, styles and geometry with the
 * components flattened. A red on the shadow page is then a statement about the
 * boundary, not about the harness, the fixture or a coordinate. The twins run
 * in the same job.
 *
 * The one coordinate in here, (60, 106), was measured rather than computed:
 * at 1366x768 the card's <p> sits at y=98, h=17 on BOTH pages — a first cut
 * put it at 84 and forgot the <p>'s default margin, which would have made the
 * inspect arm hit the card's padding on the twin and read as a harness
 * problem. `document.elementFromPoint(60, 106)` is `#inner` on the flat page
 * and the host on the shadow page, and `shadowRoot.elementFromPoint` is
 * `#inner` on the shadow page. That is the whole arm in one line.
 *
 * Spawns the CLI's Electron, so it is CI-only under the desk rules.
 */
const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href
const PRESET = 'laptop-768'
const SHADOW = fixture('shadow-arms.html')
const FLAT = fixture('shadow-arms-flat.html')
/** Inside the card's <p> on both pages at laptop-768; see the file comment. */
const IN_THE_CARD = '60,106'

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', rejectPromise)
    child.on('close', code => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

const json = async (args: string[]): Promise<Record<string, any>> => {
  const r = await runCli(args)
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

// --- arm 1: collection ------------------------------------------------------
// The card names `half-in-shadow.html` for this arm: 12 light buttons and 4
// open roots of 10 — counted from the fixture, not from the card's line. The
// control the card asks for ("reverting the traversal takes it back to 12") is
// `cli-audit.spec.ts:299`, which pins 12 today and changes with the feature.

test.describe('arm 1 — collection descends into open roots', () => {
  test('audit counts every button on half-in-shadow.html, not only the light-DOM twelve', async () => {
    const m = await json(['audit', fixture('half-in-shadow.html'), '--preset', PRESET])
    // RED TODAY: 12. The count is 12 light + 4 roots × 10.
    expect(m.summary.targets.count, 'audit stopped at the shadow boundary').toBe(52)
  })

  test('lint finds the hairline inside the card', async () => {
    const m = await json(['lint', SHADOW, '--preset', PRESET])
    // RED TODAY: 0. The 0.5px rule lives inside x-card's root.
    expect(m.summary.hairline, 'lint stopped at the shadow boundary').toBeGreaterThanOrEqual(1)
  })

  test('TWIN: lint finds the same hairline when it is in the light DOM', async () => {
    const m = await json(['lint', FLAT, '--preset', PRESET])
    expect(m.summary.hairline).toBeGreaterThanOrEqual(1)
  })
})

// --- arms 2 and 3: inspect at a point inside a root ------------------------
// One call, two questions, asserted separately so each reads at its own line.

test.describe('arms 2 and 3 — inspect at a point inside a root', () => {
  test('arm 3: names the element under the point, not the host', async () => {
    const m = await json(['inspect', SHADOW, '--preset', PRESET, '--at', IN_THE_CARD])
    expect(m.found).toBe(true)
    // RED TODAY: 'card' (the x-card host). document.elementFromPoint stops
    // at the boundary; shadowRoot.elementFromPoint from the host is what
    // reaches the <p>.
    expect(m.readout.id, `inspect stopped at the host: ${m.readout.element}`).toBe('inner')
  })

  test('arm 2: reads contrast against the component background it sits on', async () => {
    const m = await json(['inspect', SHADOW, '--preset', PRESET, '--at', IN_THE_CARD])
    expect(m.found).toBe(true)
    // RED TODAY: the ancestor walk climbs parentElement, which stops at the
    // boundary, so the text composites onto the page's white rather than the
    // card's #1f2937. Through the composed parent it reaches the card.
    expect(m.readout.background, 'contrast read against the page, not the card').toBe('#1f2937')
  })

  test('TWIN: the same point on the flat page names #inner on the card background', async () => {
    const m = await json(['inspect', FLAT, '--preset', PRESET, '--at', IN_THE_CARD])
    expect(m.found).toBe(true)
    expect(m.readout.id).toBe('inner')
    expect(m.readout.background).toBe('#1f2937')
  })
})

// --- arm 4: the walk ---------------------------------------------------------

test.describe('arm 4 — the walk scrolls a scroller inside a root', () => {
  test('audit walks the feed inside x-feed', async () => {
    const m = await json(['audit', SHADOW, '--preset', PRESET])
    // RED TODAY: 0 screenfuls, and the note says the page "has no scrollable
    // container in its light DOM" — which is exactly true and exactly the gap.
    expect(m.walked?.screenfuls, `walk found nothing: ${JSON.stringify(m.warnings)}`).toBeGreaterThan(0)
  })

  test('TWIN: audit walks the same feed when it is in the light DOM', async () => {
    const m = await json(['audit', FLAT, '--preset', PRESET])
    expect(m.walked?.screenfuls).toBeGreaterThan(0)
  })
})
