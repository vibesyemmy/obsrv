import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `obsrv inspect`: the app's inspector for a script. The contrast fixture
 * the app's own inspect spec uses, read by selector and by point, on a
 * laptop and through a budget panel; nothing found is a `found: false`,
 * not a failure; the flags are one-of.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

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

test('by selector on the laptop: element, font in mm, colours, contrast as stated and on the reference panel', async () => {
  const r = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#grey'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m).toMatchObject({ preset: 'laptop-768', cssWidth: 1366, cssHeight: 768, profile: 'reference', found: true })
  expect(m.readout).toMatchObject({
    element: 'p#grey',
    tag: 'p',
    id: 'grey',
    text: 'Grey caption text on white',
    color: '#6b7280',
    background: '#ffffff',
    backgroundNote: 'computed',
    ppi: 100,
  })
  expect(m.readout.font.px).toBe(13)
  expect(m.readout.font.mm).toBeCloseTo(3.29, 1)
  expect(m.readout.contrast).toMatchObject({ largeText: false, aaThreshold: 4.5, passesAsIs: true, panel: 'reference' })
  expect(m.readout.contrast.asIs).toBeCloseTo(4.84, 1)
  expect(r.stderr).toMatch(/inspect .* p#grey · 13px = 3\.\d+ mm · #6b7280 on #ffffff · 4\.8\d?:1 here/)
})

test('by point, and through a budget panel: the second contrast figure drops', async () => {
  const r = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--at', '20,17', '--profile', 'budget-tn'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.found).toBe(true)
  expect(m.readout.id).toBe('grey')
  expect(m.profile).toBe('budget-tn')
  expect(m.readout.contrast.panel).toBe('budget-tn')
  expect(m.readout.contrast.onPanel).toBeLessThan(m.readout.contrast.asIs)
})

test('text over an image has no contrast figure; nothing matched is found: false, exit 0', async () => {
  const photo = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#photo-text'])
  expect(photo.code, photo.stderr).toBe(0)
  const p = JSON.parse(photo.stdout)
  expect(p.found).toBe(true)
  expect(p.readout.backgroundNote).toBe('image')
  expect(p.readout.background).toBeNull()
  expect(p.readout.contrast).toBeNull()

  const none = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#no-such-thing'])
  expect(none.code, none.stderr).toBe(0)
  expect(JSON.parse(none.stdout)).toMatchObject({ found: false, readout: null })
  expect(none.stderr).toContain('nothing at selector "#no-such-thing"')
})

test('a selector the browser rejects is told apart from one that matches nothing', async () => {
  // bug-inspect-selector-silences: `p[` and `#no-such-thing` produced the same
  // answer — found: false, no note — so a typo read as "that element is not on
  // the page" and the reader went looking for what had changed.
  const bad = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', 'p['])
  expect(bad.code, bad.stderr).toBe(0)
  const b = JSON.parse(bad.stdout)
  expect(b).toMatchObject({ found: false, readout: null })
  expect(b.notes, JSON.stringify(b.notes)).toEqual([expect.stringContaining('is not a valid CSS selector, so nothing was looked for')])
  expect(bad.stderr).toContain('is not a valid CSS selector')
  // The distinction the fix exists for: the miss says neither of those things.
  const none = await runCli(['inspect', fixture('contrast.html'), '--preset', 'laptop-768', '--selector', '#no-such-thing'])
  expect(none.code, none.stderr).toBe(0)
  expect(JSON.parse(none.stdout).notes.filter((n: string) => n.includes('valid CSS selector'))).toEqual([])
  expect(none.stderr).toContain('nothing at selector "#no-such-thing"')
})

test('an element the screen never shows is measured, and the readout says it is not drawn', async () => {
  // The other half of the same card: the figures were produced for a hidden
  // element exactly as for a visible one, so a contrast pass was reported for
  // text nobody can see. The measurements stay — what the element WOULD be is
  // a fair question — and the note says what they are of.
  const notDrawn = (notes: string[]): string[] => notes.filter(n => n.includes('this element is not drawn'))
  const gone = await runCli(['inspect', fixture('hidden-text.html'), '--preset', 'laptop-768', '--selector', '#drawer-text'])
  expect(gone.code, gone.stderr).toBe(0)
  const g = JSON.parse(gone.stdout)
  expect(g.found).toBe(true)
  expect(g.readout.font.px).toBe(4)
  expect(notDrawn(g.notes), JSON.stringify(g.notes)).toEqual([expect.stringContaining('display: none')])
  // The readout carries its own copy, for a caller that reads only that.
  expect(notDrawn(g.readout.notes)).toHaveLength(1)

  const veiled = await runCli(['inspect', fixture('hidden-text.html'), '--preset', 'laptop-768', '--selector', '#veiled-text'])
  expect(veiled.code, veiled.stderr).toBe(0)
  expect(notDrawn(JSON.parse(veiled.stdout).notes)).toEqual([expect.stringContaining('visibility: hidden')])

  // An element that is drawn carries no such note: the note has to mean something.
  const shown = await runCli(['inspect', fixture('hidden-text.html'), '--preset', 'laptop-768', '--selector', '#shown'])
  expect(shown.code, shown.stderr).toBe(0)
  const sh = JSON.parse(shown.stdout)
  expect(sh.found).toBe(true)
  expect(notDrawn(sh.notes)).toEqual([])

  // `visibility` is inherited AND overridable, so a descendant that opts back
  // in is painted even under a `visibility: hidden` parent — and a reader can
  // see it. Walking ancestors for `visibility` found the parent and called
  // this not drawn, which is the opposite of true. Found by the 0.61.0 release
  // sweep — a classifier's read of #85, confirmed by Wren and Henry reading the
  // code, and not measured until this arm. `audit`'s own `shown` rule reads the element alone
  // (shared/audit.ts:122), which is what this now agrees with.
  const revealed = await runCli(['inspect', fixture('hidden-text.html'), '--preset', 'laptop-768', '--selector', '#revealed'])
  expect(revealed.code, revealed.stderr).toBe(0)
  const rv = JSON.parse(revealed.stdout)
  expect(rv.found).toBe(true)
  expect(notDrawn(rv.notes), JSON.stringify(rv.notes)).toEqual([])

  // And `display: none` still walks, because it is NOT overridable that way:
  // a child of a `display: none` parent is not rendered whatever it declares.
  // The two rules differ, and the fix is not "stop walking".
  expect(notDrawn(g.notes)).toEqual([expect.stringContaining('display: none')])
})

test('text that is not opaque: the readout says what the page states, what the screen shows, and which of the two made it so', async () => {
  // No reply had ever carried this sentence (docs/note-inventory.md, c5): every
  // fixture inspected until now states the colour it paints. A reader who
  // checks the contrast figure against the stylesheet finds a different hex
  // there, and this is the sentence that stops that reading like an error.
  const composite = (notes: string[]): string[] => notes.filter(n => n.includes('and the screen shows'))
  const page = fixture('translucent-text.html')

  const faded = await runCli(['inspect', page, '--preset', 'laptop-768', '--selector', '#faded'])
  expect(faded.code, faded.stderr).toBe(0)
  const f = JSON.parse(faded.stdout)
  expect(f.found).toBe(true)
  expect(composite(f.notes), JSON.stringify(f.notes)).toEqual([
    expect.stringMatching(
      /^the page states #0b0c0c and the screen shows #[0-9a-f]{6}: an opacity of 0\.5 composites it onto the background, and the contrast figures are of what is shown$/,
    ),
  ])

  // The other route to the same fact: an opaque element whose colour carries
  // the alpha. The sentence names which one it was.
  const alpha = await runCli(['inspect', page, '--preset', 'laptop-768', '--selector', '#alpha'])
  expect(alpha.code, alpha.stderr).toBe(0)
  const a = JSON.parse(alpha.stdout)
  expect(composite(a.notes), JSON.stringify(a.notes)).toEqual([expect.stringContaining('own alpha composites it onto the background')])

  // Opaque text carries no such note: the note has to mean something.
  const solid = await runCli(['inspect', page, '--preset', 'laptop-768', '--selector', '#solid'])
  expect(solid.code, solid.stderr).toBe(0)
  expect(composite(JSON.parse(solid.stdout).notes)).toEqual([])
})

test('a point off the screen says so, naming the viewport it is off; a point on the screen does not', async () => {
  // bug-inspect-offscreen-point-is-silent: found: false for a point the screen
  // does not have read as nothing drawn there, with nothing saying otherwise.
  const offScreen = (notes: string[]): string[] => notes.filter(n => n.includes('is outside this screen'))
  const far = await runCli(['inspect', fixture('contrast.html'), '--preset', 'pixel-8', '--at', '1000,500'])
  expect(far.code, far.stderr).toBe(0)
  const f = JSON.parse(far.stdout)
  expect(f).toMatchObject({ found: false, readout: null })
  const { cssWidth, cssHeight } = f as { cssWidth: number; cssHeight: number }
  expect(cssWidth).toBeLessThan(1000)
  expect(offScreen(f.notes), JSON.stringify(f.notes)).toEqual([
    expect.stringContaining(`the point (1000, 500) is outside this screen's CSS viewport, ${cssWidth}x${cssHeight}`),
  ])
  expect(far.stderr).toContain('warning: the point (1000, 500) is outside')

  // One row past the bottom edge is off; the last pixel on the screen is on it.
  const below = await runCli(['inspect', fixture('contrast.html'), '--preset', 'pixel-8', '--at', `10,${cssHeight}`])
  expect(below.code, below.stderr).toBe(0)
  expect(offScreen(JSON.parse(below.stdout).notes)).toHaveLength(1)
  const edge = await runCli(['inspect', fixture('contrast.html'), '--preset', 'pixel-8', '--at', `${cssWidth - 1},${cssHeight - 1}`])
  expect(edge.code, edge.stderr).toBe(0)
  const e = JSON.parse(edge.stdout)
  expect(e.found).toBe(true)
  expect(offScreen(e.notes), JSON.stringify(e.notes)).toEqual([])
})

test('exactly one of --at / --selector, and --at is x,y', async () => {
  const neither = await runCli(['inspect', fixture('contrast.html')])
  expect(neither.code).toBe(2)
  expect(neither.stderr).toMatch(/exactly one of --at <x,y> or --selector <css>/)
  const both = await runCli(['inspect', fixture('contrast.html'), '--at', '1,1', '--selector', 'p'])
  expect(both.code).toBe(2)
  const bad = await runCli(['inspect', fixture('contrast.html'), '--at', 'twenty'])
  expect(bad.code).toBe(2)
  expect(bad.stderr).toMatch(/--at: expected x,y/)
  const help = await runCli(['--help'])
  expect(help.stdout).toContain('obsrv inspect <url>')
})

test('a page that holds its main thread after load: inspect answers found false within the budget, and says why', async () => {
  const r = await runCli(['inspect', fixture('blocks-after-load.html'), '--preset', '1080p-24', '--selector', '#b', '--timeout', '3000'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.found).toBe(false)
  expect(m.notes[0]).toMatch(/^the page did not answer the inspect within 3 s of loading: .* so nothing was found/)
})

/**
 * The other half of the cut-load contract. Since 0.53.0 the audit and the
 * lint measure a page whose `load` never fires and warn (cli-lint.spec pins
 * that); inspect still errors, because a readout of one element is either
 * the element or nothing. The CLI's help and docs/throttle.md say exactly
 * that, and said the opposite for two releases because nothing here
 * objected when the behaviour changed underneath them.
 */
test.describe('a load that never finishes', () => {
  let server: Server
  let url: string
  const held: ServerResponse[] = []
  test.beforeAll(async () => {
    const html = readFileSync(resolve(__dirname, '../fixtures/never-loads.html'), 'utf8')
    server = createServer((req, res) => {
      if (req.url === '/hang.png') {
        held.push(res)
        return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })
  test.afterAll(async () => {
    for (const res of held) res.destroy()
    await new Promise<void>(r => server.close(() => r()))
  })

  test('inspect errors on a cut load, where the audit and the lint measure what stood', async () => {
    const r = await runCli(['inspect', url, '--preset', '1080p-24', '--timeout', '3000', '--selector', 'p'])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/^obsrv: load did not finish within 3000 ms: http:\/\/127\.0\.0\.1:\d+\/ — raise --timeout for the full load/m)
    expect(r.stdout).toBe('')
  })
})
