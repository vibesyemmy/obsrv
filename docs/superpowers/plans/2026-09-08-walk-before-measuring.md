# Walk the page before measuring it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live `obsrv_audit` / `obsrv_lint` walks the page a screenful at a time to the end and back before measuring, so the person watching sees the whole page pass — and, first, both walks measure an app shell correctly wherever its inner scroller has been left.

**Architecture:** Task 0 fixes the page-coordinate bug inside the two page scripts (`auditPage`, `lintPage`): an element inside the page's scroll host adds the host's `scrollLeft`/`scrollTop`, not the window's. Tasks 1–2 add the walk as MCP-side orchestration over the existing `scroll { page }` control command — a new pure-ish helper `walkPage` with injected `call`/`sleep`/`now`, wired into `liveAudit`/`liveLint` behind a `walk` flag (default on, live only). The app changes not at all; an older app answers the first page-wise scroll with a 400 and the walk becomes a note.

**Tech Stack:** TypeScript, Electron (page scripts injected as source), MCP SDK (zod schemas), Vitest (unit + browser/chromium), Playwright (e2e against the real Electron app).

**Spec:** `docs/superpowers/specs/2026-09-08-walk-before-measuring-design.md`

## Global Constraints

- `WALK_MAX_SCREENFULS = 12` (same as `MAX_TILE_BANDS` in `src/cli/main.ts:49`). `WALK_DWELL_MS = 350`.
- The walk runs only in live mode, only for `obsrv_audit` and `obsrv_lint`, never for `obsrv_inspect`, `obsrv_snap`, `obsrv_report`, `obsrv_diff`.
- Flag `walk: boolean`, default `true`. In headless mode any value is ignored with the note, verbatim: `` `walk` is live-only; there is nothing to watch in a headless render. ``
- Older-app note, verbatim: `the app predates page-wise scrolling (0.41.0); measured without walking.`
- Result field, live only, only when the walk ran: `walked: { screenfuls: number, atEnd: boolean, ms: number }`.
- **A walk must never fail an audit or a lint.** Every failure inside it becomes a note and the measurement proceeds.
- The walk ends with `scroll { page: "top" }` before measuring.
- No new control command. No app-side change. The page scripts may reference only page globals and the scroll-host helpers `SCROLL_HOST_SCRIPT` puts beside them (`rootScrolls`, `canScroll`, `isVisible`, `findScroller`, `clipTest`).
- The headless reset at `src/cli/main.ts:426-430` stays as it is.
- Never `git add -A` in this repo (`CLAUDE.md` and `.claude/launch.json` are untracked on purpose). Stage files by name.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gates: `npm run typecheck` (three tsconfigs). Unit: `npm test`. Browser: `npm run test:browser`. E2E: `npm run build` first, then `npx playwright test <spec>`. No test may launch a real Obsrv against the developer's profile: the e2e harness launches its own (`tests/e2e/launch.ts`, `OBSRV_AGENT_CONTROL=1`, throwaway user-data dir) and the MCP e2e points the server at it through `OBSRV_CONTROL_FILE`.
- Release afterwards is the usual procedure (0.42.0: new tool fields), outside this plan.

## File map

| file | responsibility after this plan |
|---|---|
| `src/shared/audit.ts` | `auditPage`: page coordinates through the scroll host (`offset(el)`); `shown` takes the element |
| `src/shared/lint.ts` | `lintPage`: the same |
| `src/mcp/walk.ts` (new) | `walkPage(deps)`, the constants, the two notes, `Walked`/`WalkDeps`/`WalkOutcome` |
| `src/mcp/server.ts` | `walk` input, `walked` output on audit + lint; `liveAudit`/`liveLint` call `walkPage`; headless note |
| `tests/browser/audit.test.ts` | new describe: an app shell scrolled down measures as at the top |
| `tests/browser/lint.test.ts` (new) | the same for `lintPage`, plus the shipped-source check lint never had |
| `tests/e2e/live-drive.spec.ts` | control-level: `scroll { page: "bottom" }` then `audit`/`lint` equal the top |
| `tests/unit/mcpWalk.test.ts` (new) | `walkPage` against an injected `call` |
| `tests/e2e/mcp-live.spec.ts` | `obsrv_audit`/`obsrv_lint` return `walked`; `walk: false` does not; headless notes |
| `skills/obsrv-screens/SKILL.md` | one sentence in the review loop |
| `README.md` | one sentence in the MCP paragraph |

---

### Task 0: Page coordinates through the scroll host

The bug (spec §0): `auditPage` and `lintPage` compute page coordinates as `rect.top + window.scrollY` and drop an element as "parked off the page" when `rect.bottom + window.scrollY <= 0`. In an app shell (`html, body { overflow: hidden }` with an inner `overflow-y: auto` container) the window never scrolls, so once the inner scroller is down, everything above the fold has a negative `top` and is dropped; `pageHeight` collapses to the viewport. Both scripts already find the scroll host (`clipTest(rootScrolls() ? null : findScroller())`); the fix is to use it for the offset too.

**Files:**
- Modify: `src/shared/audit.ts:84-106` (the `shown` / `clipped` / `pageRect` block) and the two `shown(cs, r)` call sites at `:116` and `:143`
- Modify: `src/shared/lint.ts:106-125` (the same block) and the call site at `:186`
- Test: `tests/browser/audit.test.ts` (append a describe)
- Create: `tests/browser/lint.test.ts`
- Test: `tests/e2e/live-drive.spec.ts` (append a test)

**Interfaces:**
- Consumes: `rootScrolls()`, `findScroller()`, `clipTest(host)` from `src/shared/scrollHost.ts` (already imported by both files and already part of `SCROLL_HOST_SCRIPT`).
- Produces: nothing new for later tasks. `AuditReport` / `LintReport` shapes are unchanged; the parser (`parseAuditReport` / `parseLintReport` in `src/shared/ipcPayloads.ts`) is untouched.

- [ ] **Step 1: Write the failing browser test for the audit**

Append to `tests/browser/audit.test.ts`:

```ts
/**
 * An app shell: the document cannot scroll, an inner container does. Page
 * coordinates used to add `window.scrollY` — 0 here however far the inner
 * scroller has gone — so once it was scrolled down, everything above the fold
 * had a negative top and was dropped as parked off the page, and pageHeight
 * collapsed to the viewport. Measured on usekolo.app at the bottom: 11
 * targets and pageHeight 768 on a 7,445 px page.
 */
describe('an app shell whose inner scroller has been scrolled', () => {
  let shell: HTMLDivElement
  let scroller: HTMLElement

  beforeEach(() => {
    shell = document.createElement('div')
    shell.innerHTML = `
      <style>
        #shell { position: fixed; inset: 0; overflow: hidden; background: #fff; }
        #chrome { position: absolute; left: 0; top: 0; right: 0; height: 48px; }
        #scroller { position: absolute; left: 0; top: 48px; right: 0; bottom: 0; overflow-y: auto; }
        #scroller .row { height: 120px; }
        #scroller p { margin: 0; font-size: 16px; }
        #deep { display: block; width: 24px; height: 24px; padding: 0; font-size: 10px; }
      </style>
      <div id="shell">
        <header id="chrome"><button id="menu" type="button">Menu</button></header>
        <main id="scroller">
          ${Array.from({ length: 20 }, (_, i) => `<div class="row"><p id="row${i + 1}">Row ${i + 1}</p></div>`).join('')}
          <div class="row"><button id="deep" type="button">x</button></div>
        </main>
      </div>
    `
    document.body.append(shell)
    scroller = document.getElementById('scroller')!
  })
  afterEach(() => shell.remove())

  const measure = (scrollTop: number) => {
    scroller.scrollTop = scrollTop
    return auditPage(2000, 3000)
  }
  const textY = (r: ReturnType<typeof auditPage>, id: string) => r.text.find(t => t.element === `p#${id}`)?.rect.y
  const targetY = (r: ReturnType<typeof auditPage>, id: string) => r.targets.find(t => t.element === `button#${id}`)?.rect.y

  it('measures the same page wherever the scroller has been left', () => {
    const atTop = measure(0)
    const down = measure(600)
    expect(scroller.scrollTop).toBe(600) // the fixture really scrolls; otherwise the test proves nothing

    // Row 1 is above the fold at 600: it used to be dropped as "off the page".
    expect(textY(atTop, 'row1')).toBeCloseTo(48, 0)
    expect(textY(down, 'row1')).toBeCloseTo(48, 0)
    expect(textY(atTop, 'row13')).toBeCloseTo(48 + 12 * 120, 0)
    expect(textY(down, 'row13')).toBeCloseTo(48 + 12 * 120, 0)
    expect(targetY(down, 'deep')).toBeCloseTo(targetY(atTop, 'deep')!, 0)

    expect(down.targets.length).toBe(atTop.targets.length)
    expect(down.text.length).toBe(atTop.text.length)
    expect(down.pageHeight).toBe(atTop.pageHeight)
    expect(atTop.pageHeight).toBeGreaterThan(innerHeight)
  })

  it('leaves what is outside the scroller where the window puts it', () => {
    const atTop = measure(0)
    const down = measure(600)
    // The shell's own chrome, and #host from the file-level fixture: neither moves with the inner scroller.
    expect(targetY(down, 'menu')).toBeCloseTo(targetY(atTop, 'menu')!, 0)
    expect(targetY(down, 'big')).toBeCloseTo(targetY(atTop, 'big')!, 0)
  })

  it('works as the shipped source with a scrolled host', () => {
    scroller.scrollTop = 600
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${AUDIT_SCRIPT}`)() as typeof auditPage
    expect(fromSource(2000, 3000)).toEqual(auditPage(2000, 3000))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project browser tests/browser/audit.test.ts -t "app shell"`
Expected: FAIL — `textY(down, 'row1')` is `undefined` (row 1 dropped), and `down.pageHeight` is less than `atTop.pageHeight`.

- [ ] **Step 3: Fix `auditPage`**

In `src/shared/audit.ts`, replace the block from the `// Rendered, and somewhere a finger or an eye could reach` comment through the end of `pageRect` (lines 84–106) with:

```ts
  // The element the capture scrolls — the shell's scroller, or the document
  // when the document is what scrolls. Boxes held out of view by any *other*
  // scroller are marked: their page coordinates are not a place on the page.
  const host = rootScrolls() ? null : findScroller()
  const clipped = clipTest(host)
  // Page coordinates are viewport coordinates plus what the page's own
  // scroller has scrolled away. On an app shell that scroller is `host`, not
  // the window — `window.scrollY` stays 0 however far its content has gone —
  // so an element inside it adds the host's offset; anything outside it (the
  // shell's fixed chrome) moves with the window alone. Measured on
  // usekolo.app scrolled to the bottom before this: every element above the
  // fold had a negative top, was dropped as parked off the page, and
  // pageHeight collapsed to the viewport.
  const offset = (el: Element): { x: number; y: number } =>
    host !== null && host !== el && host.contains(el)
      ? { x: scrollX + host.scrollLeft, y: scrollY + host.scrollTop }
      : { x: scrollX, y: scrollY }
  // Rendered, and somewhere a finger or an eye could reach: not a zero box,
  // not hidden, not the 1×1 clipped box of the "visually hidden" pattern
  // (screen-reader text, and controls made accessible that way — measured
  // on real pages, those were the 0.2 mm "targets"), and not parked off the
  // page at a negative offset.
  const shown = (cs: CSSStyleDeclaration, r: DOMRect, el: Element): boolean => {
    const o = offset(el)
    return (
      r.width > 0 &&
      r.height > 0 &&
      !(r.width <= 1 && r.height <= 1) &&
      r.right + o.x > 0 &&
      r.bottom + o.y > 0 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      cs.opacity !== '0'
    )
  }
  const pageRect = (r: DOMRect, el: Element): AuditRect => {
    const o = offset(el)
    return {
      x: r.left + o.x,
      y: r.top + o.y,
      width: r.width,
      height: r.height,
      ...(clipped(r, el) ? { clipped: true as const } : {}),
    }
  }
```

Then change both call sites — `if (!shown(cs, r)) continue` at the old lines 116 and 143 — to `if (!shown(cs, r, el)) continue`.

- [ ] **Step 4: Run the audit browser tests**

Run: `npx vitest run --project browser tests/browser/audit.test.ts`
Expected: PASS, every describe (the existing "rects are page coordinates", "panel with its own scrollbar" and shipped-source tests included).

- [ ] **Step 5: Write the failing browser test for the lint**

Create `tests/browser/lint.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LINT_SCRIPT, lintPage } from '../../src/shared/lint'

/**
 * `lintPage` runs inside the target page and means nothing without real
 * layout, so it is tested in a real browser, like `auditPage`. Only the
 * page-coordinate rule is covered here; the rules themselves are judged on
 * the parser side (tests/unit/cliLint.test.ts) and end to end.
 */

const EDGE_BELOW_PX = 1 // one device pixel on a 1x screen, in CSS px

/**
 * An app shell: the document cannot scroll, an inner container does. Page
 * coordinates used to add `window.scrollY` — 0 here however far the inner
 * scroller has gone — so once it was scrolled down, everything above the fold
 * was dropped as parked off the page and pageHeight collapsed to the viewport
 * (audit.test.ts has the same fixture and the measurement that found it).
 */
describe('an app shell whose inner scroller has been scrolled', () => {
  let shell: HTMLDivElement
  let scroller: HTMLElement

  beforeEach(() => {
    shell = document.createElement('div')
    shell.innerHTML = `
      <style>
        #shell { position: fixed; inset: 0; overflow: hidden; background: #fff; }
        #chrome { position: absolute; left: 0; top: 0; right: 0; height: 48px; }
        #scroller { position: absolute; left: 0; top: 48px; right: 0; bottom: 0; overflow-y: auto; }
        #scroller .row { height: 120px; }
        #scroller p { margin: 0; font-size: 16px; color: #111; }
        #menu { font-size: 16px; }
      </style>
      <div id="shell">
        <header id="chrome"><button id="menu" type="button">Menu</button></header>
        <main id="scroller">
          ${Array.from({ length: 20 }, (_, i) => `<div class="row"><p id="row${i + 1}">Row ${i + 1}</p></div>`).join('')}
        </main>
      </div>
    `
    document.body.append(shell)
    scroller = document.getElementById('scroller')!
  })
  afterEach(() => shell.remove())

  const measure = async (scrollTop: number) => {
    scroller.scrollTop = scrollTop
    return lintPage(EDGE_BELOW_PX, 3000, 2000, 500)
  }
  const textY = (r: Awaited<ReturnType<typeof lintPage>>, id: string) => r.text.find(t => t.element === `p#${id}`)?.rect.y

  it('measures the same page wherever the scroller has been left', async () => {
    const atTop = await measure(0)
    const down = await measure(600)
    expect(scroller.scrollTop).toBe(600)

    expect(textY(atTop, 'row1')).toBeCloseTo(48, 0)
    expect(textY(down, 'row1')).toBeCloseTo(48, 0)
    expect(textY(down, 'row13')).toBeCloseTo(48 + 12 * 120, 0)
    expect(down.text.length).toBe(atTop.text.length)
    expect(down.pageHeight).toBe(atTop.pageHeight)
    expect(atTop.pageHeight).toBeGreaterThan(innerHeight)
  })

  it('leaves what is outside the scroller where the window puts it', async () => {
    const atTop = await measure(0)
    const down = await measure(600)
    const menu = (r: Awaited<ReturnType<typeof lintPage>>) => r.text.find(t => t.element === 'button#menu')?.rect.y
    expect(menu(down)).toBeCloseTo(menu(atTop)!, 0)
  })

  it('works as the shipped source, which must be self-contained', async () => {
    scroller.scrollTop = 600
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${LINT_SCRIPT}`)() as typeof lintPage
    expect(await fromSource(EDGE_BELOW_PX, 3000, 2000, 500)).toEqual(await lintPage(EDGE_BELOW_PX, 3000, 2000, 500))
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run --project browser tests/browser/lint.test.ts`
Expected: FAIL on the first test — `textY(down, 'row1')` is `undefined`.

- [ ] **Step 7: Fix `lintPage`**

In `src/shared/lint.ts`, replace the block from `// Rendered and somewhere an eye could reach: the audit's rule, kept in step.` through the end of `pageRect` (lines 106–125) with:

```ts
  // See audit.ts: the element the capture scrolls, and boxes some *other*
  // scroller holds out of view have coordinates that are the element's, not
  // a place on the page.
  const host = rootScrolls() ? null : findScroller()
  const clipped = clipTest(host)
  // Page coordinates are viewport coordinates plus what the page's own
  // scroller has scrolled away — the host's offset for what it holds, the
  // window's for everything else. See audit.ts for the measurement.
  const offset = (el: Element): { x: number; y: number } =>
    host !== null && host !== el && host.contains(el)
      ? { x: scrollX + host.scrollLeft, y: scrollY + host.scrollTop }
      : { x: scrollX, y: scrollY }
  // Rendered and somewhere an eye could reach: the audit's rule, kept in step.
  const shown = (cs: CSSStyleDeclaration, r: DOMRect, el: Element): boolean => {
    const o = offset(el)
    return (
      r.width > 0 &&
      r.height > 0 &&
      !(r.width <= 1 && r.height <= 1) &&
      r.right + o.x > 0 &&
      r.bottom + o.y > 0 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      cs.opacity !== '0'
    )
  }
  const pageRect = (r: DOMRect, el: Element): LintRect => {
    const o = offset(el)
    return {
      x: r.left + o.x,
      y: r.top + o.y,
      width: r.width,
      height: r.height,
      ...(clipped(r, el) ? { clipped: true as const } : {}),
    }
  }
```

Then change the call site at the old line 186 — `if (!shown(cs, r)) continue` — to `if (!shown(cs, r, el)) continue`.

- [ ] **Step 8: Run both browser files, then the whole browser project**

Run: `npx vitest run --project browser tests/browser/lint.test.ts tests/browser/audit.test.ts`
Expected: PASS.
Run: `npm run test:browser`
Expected: PASS (the shader/stuckChrome/inspect/findScroller files are untouched and must stay green).

- [ ] **Step 9: Write the failing e2e at the control level**

In `tests/e2e/live-drive.spec.ts`, add after the `SOLID_RED` constant (line 26):

```ts
const APP_SHELL_FINDINGS = pathToFileURL(resolve(__dirname, '../fixtures/app-shell-findings.html')).href
```

and append at the end of the file:

```ts
test('audit and lint measure an app shell the same wherever its scroller has been left', async () => {
  // Measured on usekolo.app scrolled to the bottom: 11 targets and a
  // pageHeight of 768 on a 7,445 px page. The walks added window.scrollY,
  // which is 0 on an app shell however far its inner scroller has gone, so
  // everything above the fold was dropped as parked off the page. The
  // headless capture resets the scroller first (src/cli/main.ts); a live
  // measurement follows whatever the user or an agent scrolled.
  await call('navigate', { url: APP_SHELL_FINDINGS })
  await expect.poll(async () => (await call('status')).body.url).toBe(APP_SHELL_FINDINGS)
  await call('setPreset', { id: 'laptop-768' })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport().width)).toBe(1366)

  const auditTop = await call('audit')
  const lintTop = await call('lint')
  expect(auditTop.status).toBe(200)
  expect(lintTop.status).toBe(200)

  const moved = await call('scroll', { page: 'bottom' })
  expect(moved.status).toBe(200)
  expect(moved.body).toMatchObject({ ok: true, scroller: 'element', atEnd: true })
  expect((moved.body.scrolled as { y: number }).y).toBeGreaterThan(500)

  const auditDown = await call('audit')
  const lintDown = await call('lint')

  type Finding = { kind?: string; rule?: string; element: string; rect: { y: number } }
  const key = (f: Finding) => `${f.kind ?? f.rule}:${f.element}:${Math.round(f.rect.y)}`

  expect(auditTop.body.pageHeight as number).toBeGreaterThan(768)
  expect(auditDown.body.pageHeight).toBe(auditTop.body.pageHeight)
  expect(auditDown.body.summary).toEqual(auditTop.body.summary)
  expect((auditDown.body.findings as Finding[]).map(key)).toEqual((auditTop.body.findings as Finding[]).map(key))
  expect((auditTop.body.findings as Finding[]).some(f => f.element === 'button#deep-button')).toBe(true)

  expect(lintDown.body.pageHeight).toBe(lintTop.body.pageHeight)
  expect(lintDown.body.summary).toEqual(lintTop.body.summary)
  expect((lintDown.body.findings as Finding[]).map(key)).toEqual((lintTop.body.findings as Finding[]).map(key))
  expect((lintTop.body.findings as Finding[]).some(f => f.rule === 'contrast' && f.element === 'p#deep-text')).toBe(true)

  await call('scroll', { page: 'top' })
})
```

- [ ] **Step 10: Build and run the e2e; the fix is already in, so it must pass — then prove it would have failed**

Run: `npm run build && npx playwright test tests/e2e/live-drive.spec.ts -g "wherever its scroller"`
Expected: PASS.

Then `git stash push src/shared/audit.ts src/shared/lint.ts`, `npm run build`, run the same command — Expected: FAIL (`auditDown.body.pageHeight` is 768 and the summaries differ) — then `git stash pop` and `npm run build` again. Record the failing assertion in the task report; this is the test that would have caught 0.29.

- [ ] **Step 11: Typecheck and unit**

Run: `npm run typecheck && npm test`
Expected: clean; the unit suite is untouched by this task.

- [ ] **Step 12: Commit**

```bash
git add src/shared/audit.ts src/shared/lint.ts tests/browser/audit.test.ts tests/browser/lint.test.ts tests/e2e/live-drive.spec.ts
git commit -m "fix: audit and lint measure an app shell wherever its scroller has been left

Both page scripts computed page coordinates as rect.top + window.scrollY and
dropped an element as parked off the page when rect.bottom + window.scrollY
was not positive. In an app shell the window never scrolls, so once the inner
scroller was down every element above the fold had a negative top and was
dropped, and pageHeight collapsed to the viewport: usekolo.app at the bottom
reported 11 targets and pageHeight 768 on a 7,445 px page. The headless
capture resets the scroller first and says why; live audit and lint never
did, so they have been wrong on a scrolled app shell since 0.29.

An element inside the page's scroll host now adds the host's offset; what is
outside it (the shell's fixed chrome) moves with the window alone. Browser
tests scroll a shell fixture and measure twice; the control-level e2e scrolls
app-shell-findings.html to the bottom and expects the audit and the lint of
the top.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `walkPage` — the walk as a unit-testable helper

**Files:**
- Create: `src/mcp/walk.ts`
- Create: `tests/unit/mcpWalk.test.ts`

**Interfaces:**
- Consumes: `ControlCallError` from `src/mcp/control.ts` (`readonly statusCode?: number`; a 0.40.1 app answers `scroll { page }` with `400` and the message `scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets`). The app's `scroll` reply (`src/main/controlServer.ts:458-474`): `{ ok: true, scrolled: { x, y } | null, scroller?: 'root' | 'element', atEnd?: boolean, warnings?: string[] }`.
- Produces, for Task 2:

```ts
export const WALK_MAX_SCREENFULS = 12
export const WALK_DWELL_MS = 350
export const WALK_OLDER_APP_NOTE = 'the app predates page-wise scrolling (0.41.0); measured without walking.'
export const WALK_HEADLESS_NOTE = '`walk` is live-only; there is nothing to watch in a headless render.'
export interface Walked { screenfuls: number; atEnd: boolean; ms: number }
export interface WalkDeps {
  call: (command: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  sleep: (ms: number) => Promise<void>
  now: () => number
}
export interface WalkOutcome { walked?: Walked; notes: string[] }
export function walkPage(deps: WalkDeps): Promise<WalkOutcome>
```

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/mcpWalk.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ControlCallError } from '../../src/mcp/control'
import { WALK_DWELL_MS, WALK_MAX_SCREENFULS, WALK_OLDER_APP_NOTE, walkPage, type WalkDeps } from '../../src/mcp/walk'

/**
 * The walk over an injected control call. `answers` is what each successive
 * `scroll { page: "next" }` returns; `top` scrolls always succeed unless the
 * test says otherwise. The clock advances only through `sleep`.
 */
function deps(
  answers: Array<Record<string, unknown> | Error>,
  opts: { top?: Error } = {},
): WalkDeps & { commands: Array<{ command: string; payload: Record<string, unknown> }>; slept: number[]; clock: number } {
  const d = {
    commands: [] as Array<{ command: string; payload: Record<string, unknown> }>,
    slept: [] as number[],
    clock: 0,
    call: vi.fn(async (command: string, payload: Record<string, unknown>) => {
      d.commands.push({ command, payload })
      if (payload['page'] === 'top') {
        if (opts.top) throw opts.top
        return { ok: true, scrolled: { x: 0, y: 0 }, scroller: 'root', atEnd: false }
      }
      const next = answers.shift()
      if (next === undefined) throw new Error('test: more scrolls than answers')
      if (next instanceof Error) throw next
      return next
    }),
    sleep: vi.fn(async (ms: number) => {
      d.slept.push(ms)
      d.clock += ms
    }),
    now: () => d.clock,
  }
  return d
}

const step = (y: number, atEnd = false) => ({ ok: true, scrolled: { x: 0, y }, scroller: 'root', atEnd })
const older = () => new ControlCallError('obsrv control scroll: scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets', 400)

describe('walkPage', () => {
  it('walks to the end a screenful at a time, dwells on each, and returns to the top', async () => {
    const d = deps([step(768), step(1536), step(2000, true)])
    const r = await walkPage(d)
    expect(r).toEqual({ walked: { screenfuls: 3, atEnd: true, ms: 3 * WALK_DWELL_MS }, notes: [] })
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'next', 'next', 'top'])
    expect(d.commands.every(c => c.command === 'scroll')).toBe(true)
    expect(d.slept).toEqual([WALK_DWELL_MS, WALK_DWELL_MS, WALK_DWELL_MS])
  })

  it('stops at the cap and says so; atEnd is false', async () => {
    const d = deps(Array.from({ length: WALK_MAX_SCREENFULS + 5 }, (_, i) => step((i + 1) * 768)))
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: WALK_MAX_SCREENFULS, atEnd: false, ms: WALK_MAX_SCREENFULS * WALK_DWELL_MS })
    expect(r.notes.join(' ')).toContain(`${WALK_MAX_SCREENFULS} screenfuls`)
    expect(d.commands.filter(c => c.payload['page'] === 'next')).toHaveLength(WALK_MAX_SCREENFULS)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
  })

  it('a page with nothing to scroll: the first next lands where the page already was — zero screenfuls, at the end, no dwell', async () => {
    const d = deps([step(0), step(0), step(0)])
    const r = await walkPage(d)
    expect(r).toEqual({ walked: { screenfuls: 0, atEnd: true, ms: 0 }, notes: [] })
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'top'])
    expect(d.slept).toEqual([])
  })

  it('an unconfirmed scroll (scrolled: null) is the end: stop, note, return to the top', async () => {
    const d = deps([step(768), { ok: true, scrolled: null, warnings: ['scroll offset could not be confirmed'] }, step(3000)])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 1, atEnd: false, ms: WALK_DWELL_MS })
    expect(r.notes.join(' ')).toMatch(/did not confirm/)
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'next', 'top'])
  })

  it('an app that predates page-wise scrolling: no walk, the note, nothing else asked of it', async () => {
    const d = deps([], { top: older() })
    const r = await walkPage(d)
    expect(r).toEqual({ notes: [WALK_OLDER_APP_NOTE] })
    expect(d.commands).toHaveLength(1)
    expect(d.slept).toEqual([])
  })

  it('any other failure mid-walk is a note, not an error, and the page is still sent back to the top', async () => {
    const d = deps([step(768), new Error('socket hang up')])
    const r = await walkPage(d)
    expect(r.walked).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/cut short.*socket hang up/)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
  })

  it('a failure on the final return to the top is swallowed: the measurement must still happen', async () => {
    const d = deps([step(768, true)])
    let tops = 0
    const call = d.call
    d.call = vi.fn(async (command: string, payload: Record<string, unknown>) => {
      if (payload['page'] === 'top' && ++tops === 2) throw new Error('gone')
      return call(command, payload)
    })
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 1, atEnd: true, ms: WALK_DWELL_MS })
    expect(r.notes.join(' ')).toMatch(/return to the top/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit tests/unit/mcpWalk.test.ts`
Expected: FAIL — cannot resolve `../../src/mcp/walk`.

- [ ] **Step 3: Write `src/mcp/walk.ts`**

```ts
import { ControlCallError } from './control'

/**
 * Walking the page before measuring it.
 *
 * A live audit or lint reads the DOM without moving the window, which is
 * correct and, to the person who installed a window in order to watch,
 * indistinguishable from nothing happening. So before it measures, the MCP
 * server scrolls the page a screenful at a time to the end, then back to the
 * top — orchestration over the app's own `scroll { page }` command (0.41.0),
 * so an older app is a note, not a failure. Measured on usekolo.app, which
 * reveals sections on scroll, the walk also changed what was measured: seven
 * targets and sixteen text elements a top-only audit never sees. See
 * docs/superpowers/specs/2026-09-08-walk-before-measuring-design.md.
 */

/** Most screenfuls a walk takes — the same cap the full-page capture has (`MAX_TILE_BANDS`). */
export const WALK_MAX_SCREENFULS = 12
/**
 * Pause on each screenful, on top of the scroll's own confirmation, so an eye
 * can land on it. Measured: nine screenfuls in 2,843 ms on usekolo.app, the
 * dwell nearly the whole of it.
 */
export const WALK_DWELL_MS = 350
export const WALK_OLDER_APP_NOTE = 'the app predates page-wise scrolling (0.41.0); measured without walking.'
export const WALK_HEADLESS_NOTE = '`walk` is live-only; there is nothing to watch in a headless render.'

export interface Walked {
  screenfuls: number
  /** False with `screenfuls === WALK_MAX_SCREENFULS` means the cap stopped it. */
  atEnd: boolean
  ms: number
}

export interface WalkDeps {
  /** One control command against the live app; `controlCall` bound to its info in production. */
  call: (command: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface WalkOutcome {
  /** Absent when the walk did not run to a measurement — the notes say why. */
  walked?: Walked
  notes: string[]
}

/**
 * `scroll { page: "top" }`, then `next` until `atEnd`, the cap, or a scroll
 * the page did not confirm; then `top` again. Never throws: a walk must not
 * fail the measurement it precedes, so every failure is a note.
 */
export async function walkPage(deps: WalkDeps): Promise<WalkOutcome> {
  const notes: string[] = []
  const started = deps.now()
  const scroll = (page: 'top' | 'next'): Promise<Record<string, unknown>> => deps.call('scroll', { page })
  const backToTop = async (): Promise<void> => {
    try {
      await scroll('top')
    } catch (e) {
      notes.push(`the walk could not return to the top afterwards (${message(e)}); measured where it stopped.`)
    }
  }

  try {
    await scroll('top')
  } catch (e) {
    if (isOlderApp(e)) return { notes: [WALK_OLDER_APP_NOTE] }
    notes.push(`the walk was cut short before it began (${message(e)}); measured without walking.`)
    return { notes }
  }

  let screenfuls = 0
  let atEnd = false
  // The offset the last scroll reached. A `next` that lands where the page
  // already was has no more page to show — the end, whatever `atEnd` says —
  // so a one-screen page is zero screenfuls, not twelve dwells at offset 0.
  let lastY: number | null = 0
  try {
    while (screenfuls < WALK_MAX_SCREENFULS) {
      const r = await scroll('next')
      const at = r['scrolled']
      if (at === null || at === undefined) {
        notes.push('the page did not confirm a scroll during the walk; the walk stopped there.')
        break
      }
      const y = typeof (at as { y?: unknown }).y === 'number' ? (at as { y: number }).y : null
      if (y !== null && y === lastY) {
        atEnd = true
        break
      }
      lastY = y
      screenfuls++
      await deps.sleep(WALK_DWELL_MS)
      if (r['atEnd'] === true) {
        atEnd = true
        break
      }
    }
  } catch (e) {
    notes.push(`the walk was cut short after ${screenfuls} screenful${screenfuls === 1 ? '' : 's'} (${message(e)}); measured without walking.`)
    await backToTop()
    return { notes }
  }
  if (!atEnd && screenfuls >= WALK_MAX_SCREENFULS) {
    notes.push(`the walk stopped after ${WALK_MAX_SCREENFULS} screenfuls without reaching the end of the page; the measurement covers the whole page regardless.`)
  }
  await backToTop()
  return { walked: { screenfuls, atEnd, ms: deps.now() - started }, notes }
}

/** A 400 to `scroll { page }` is an app whose `parseScrollRequest` predates `page` (before 0.41.0). */
function isOlderApp(e: unknown): boolean {
  return e instanceof ControlCallError && e.statusCode === 400
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run --project unit tests/unit/mcpWalk.test.ts`
Expected: PASS, seven tests.

- [ ] **Step 5: Typecheck and the whole unit project**

Run: `npm run typecheck && npm test`
Expected: clean. (`tsconfig.mcp.json` must compile `src/mcp/walk.ts` — it includes `src/mcp/**`; confirm by the typecheck passing, not by editing the tsconfig.)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/walk.ts tests/unit/mcpWalk.test.ts
git commit -m "feat(mcp): walkPage — scroll the page to the end and back before measuring

The walk as a helper over an injected control call: top, then next until
atEnd, the twelve-screenful cap, or a scroll the page did not confirm; a
350 ms dwell on each screenful; then top again. It never throws — a walk
must not fail the measurement it precedes — so an app older than 0.41.0
(a 400 to the first page-wise scroll) and any transport failure become
notes. Unit-tested against a fake call with a clock that moves only through
sleep. Not wired in yet.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `walk` on `obsrv_audit` and `obsrv_lint`, end to end, and the docs

**Files:**
- Modify: `src/mcp/server.ts` — imports (`:17-45`); `auditInputShape` (`:1015-1063`) and `lintInputShape` (starts `:1237`); `auditOutputShape` (`:1081-1125`) and the lint output shape (the `const lintOutputShape = {` after it); `AuditHandlerInput` (`:1127`) and `LintHandlerInput` (`:1356`); `liveAudit` (`:1129-1165`) and `liveLint` (`:1358-1389`); the two `registerTool` handlers' headless branches (audit `:1197-1234`, lint from `:1416`)
- Test: `tests/e2e/mcp-live.spec.ts` (append)
- Modify: `skills/obsrv-screens/SKILL.md` (`## Review (live)`, step 3)
- Modify: `README.md:213-216`

**Interfaces:**
- Consumes from Task 1: `walkPage`, `WALK_HEADLESS_NOTE`, `type Walked`, `type WalkDeps` from `./walk`; `controlCall` and `LIVE_APPLY_TIMEOUT_MS` (= 5 000, `server.ts:674`) already in `server.ts`; the module-level `sleep` at `server.ts:699`.
- Produces: the public surface — `walk?: boolean` input and `walked?: { screenfuls, atEnd, ms }` output on both tools.

- [ ] **Step 1: Write the failing e2e**

Append to `tests/e2e/mcp-live.spec.ts`:

```ts
test('obsrv_audit walks the page before measuring: walked in the result, the page back at the top, the numbers unchanged', async () => {
  await call('obsrv_drive', { preset: 'laptop-768', textScale: 1 })
  const walked = await call('obsrv_audit', { url: fixture('tall.html') })
  expect(walked.isError).toBeFalsy()
  const w = walked.structuredContent as { walked?: { screenfuls: number; atEnd: boolean; ms: number }; summary: unknown; notes: string[] }
  expect(w.walked).toBeDefined()
  // tall.html is ~5,000 px: several screenfuls at 768, well under the cap.
  expect(w.walked!.screenfuls).toBeGreaterThan(1)
  expect(w.walked!.screenfuls).toBeLessThan(12)
  expect(w.walked!.atEnd).toBe(true)
  expect(w.walked!.ms).toBeGreaterThan(0)
  expect(w.notes).toEqual([])
  // The walk ends at the top: a highlight that follows maps through the current scroll.
  const scrollY = await app.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('window.scrollY') as Promise<number>)
  expect(scrollY).toBe(0)

  // walk: false measures without moving, and reports no walk — same numbers.
  const quiet = await call('obsrv_audit', { walk: false })
  const q = quiet.structuredContent as { walked?: unknown; summary: unknown; notes: string[] }
  expect(q.walked).toBeUndefined()
  expect(q.summary).toEqual(w.summary)
  expect(q.notes).toEqual([])
})

test('obsrv_lint walks too, and walk: false does not', async () => {
  const walked = (await call('obsrv_lint', { url: fixture('tall.html') })).structuredContent as { walked?: { atEnd: boolean }; summary: unknown }
  expect(walked.walked?.atEnd).toBe(true)
  const quiet = (await call('obsrv_lint', { walk: false })).structuredContent as { walked?: unknown; summary: unknown }
  expect(quiet.walked).toBeUndefined()
  expect(quiet.summary).toEqual(walked.summary)
})

test('walk is ignored in headless mode, with a note', async () => {
  const r = await call('obsrv_audit', { url: fixture('tall.html'), mode: 'headless', walk: true })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as { mode: string; walked?: unknown; notes: string[] }
  expect(m.mode).toBe('headless')
  expect(m.walked).toBeUndefined()
  expect(m.notes.join(' ')).toContain('`walk` is live-only')
})
```

- [ ] **Step 2: Build and run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/mcp-live.spec.ts -g "walk"`
Expected: FAIL — `walked` undefined on the first test (and the MCP SDK rejects the unknown `walk` argument, or ignores it; either way the assertions fail).

- [ ] **Step 3: Wire the server**

In `src/mcp/server.ts`:

(a) Imports — after line 17 (`import { controlCall, ensureLive, type LiveApp } from './control'`) add:

```ts
import { WALK_HEADLESS_NOTE, walkPage, type WalkDeps, type Walked } from './walk'
```

(b) Below the module-level `sleep` (line 699), add:

```ts
/** The walk's control calls, bound to the live app: every scroll gets the apply budget. */
const walkDeps = (info: LiveApp['info']): WalkDeps => ({
  call: (command, payload) => controlCall(info, command, payload, LIVE_APPLY_TIMEOUT_MS),
  sleep,
  now: Date.now,
})

const walkField = z
  .boolean()
  .optional()
  .describe(
    'Live only. Default true: before measuring, the page is scrolled a screenful at a time to the end and back to ' +
      'the top, so the user watching the window sees the whole page pass (and lazy sections mount). false: measure ' +
      'without moving — for re-measuring after a fix. Ignored in headless mode, with a note.',
  )

const walkedField = z
  .object({ screenfuls: z.number(), atEnd: z.boolean(), ms: z.number() })
  .optional()
  .describe(
    'Live only, when the page was walked before measuring: screenfuls scrolled, whether the end was reached ' +
      '(false with 12 screenfuls: the cap stopped it) and the time it took. Absent when the walk did not run — ' +
      'walk: false, headless, or an app older than 0.41.0 (a note says which). Two runs that disagree on a ' +
      'lazy-loading page differ here.',
  )
```

(c) `auditInputShape`: add `walk: walkField,` after `textMm`. `lintInputShape`: add `walk: walkField,` after its `thinPx` field.

(d) `auditOutputShape`: add `walked: walkedField,` after `launched`. Lint output shape: the same, after its `launched`.

(e) Types:

```ts
type AuditHandlerInput = Omit<AuditToolInput, 'url'> & { url?: string | undefined; mode?: 'auto' | 'headless' | 'live'; walk?: boolean }
type LintHandlerInput = Omit<LintToolInput, 'url'> & { url?: string | undefined; mode?: 'auto' | 'headless' | 'live'; groupsOnly?: boolean; walk?: boolean }
```

(f) `liveAudit` — between the navigate block and `const payload = {`:

```ts
    // The person watching sees the page pass before the number arrives; on a
    // page that mounts sections on scroll, the number is of the whole page.
    let walked: Walked | undefined
    if (input.walk !== false) {
      const w = await walkPage(walkDeps(info))
      walked = w.walked
      notes.push(...w.notes)
    }
```

and in its `structured` object add `...(walked !== undefined ? { walked } : {}),` after `tabIndex: status.tabIndex,`. Do exactly the same in `liveLint` (before `const payload = input.thinPx …`, and in its `structured`).

(g) Headless branches. In the `obsrv_audit` handler, right after `const notes = resolved.notes`, add:

```ts
    if (input.walk !== undefined) notes.push(WALK_HEADLESS_NOTE)
```

Same line in the `obsrv_lint` handler after its `const notes = resolved.notes`.

(h) Descriptions. In the `obsrv_audit` description, after the sentence ending `A live audit names the tab it measured (\`tabId\`, \`tabIndex\`).` append:

```
 Live, it walks the page a screenful at a time to the end and back before measuring, so the user sees it look and lazy sections mount (\`walked\` in the result); \`walk: false\` measures without moving.
```

In the `obsrv_lint` description, append the same sentence at the very end (after its last string literal, inside the template).

- [ ] **Step 4: Typecheck, build, run the new e2e, then the whole live specs**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/mcp-live.spec.ts -g "walk"`
Expected: PASS, three tests.

Run: `npx playwright test tests/e2e/mcp-live.spec.ts tests/e2e/live-drive.spec.ts`
Expected: PASS. The existing `obsrv_audit (auto)` and `obsrv_lint (auto)` tests assert `notes: []` — audit.html and lint.html are one screen, so the walk is one `next` answering `atEnd: true` and adds no note; they must stay green.

- [ ] **Step 5: The skill and the README**

`skills/obsrv-screens/SKILL.md`, `## Review (live)`, step 3 — after the sentence `` `obsrv_audit`, `obsrv_lint`, `obsrv_inspect` in `mode: "auto"` measure the tab in front. `` append:

```
`obsrv_audit` and `obsrv_lint` walk the page a screenful at a time before measuring, so the user sees it look (`walked` in the result); pass `walk: false` to re-measure quietly after a fix.
```

`README.md`, the paragraph at lines 213–216 — after `after whatever the drive did to it;` and before `` `obsrv_report` is the exception `` insert:

```
`obsrv_audit` and `obsrv_lint` walk the page to the end and back first, so you see it looked at;
```

Run: `npm test` (the plugin/skill unit tests read `SKILL.md`; they must stay green).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts tests/e2e/mcp-live.spec.ts skills/obsrv-screens/SKILL.md README.md
git commit -m "feat(mcp): obsrv_audit and obsrv_lint walk the page before measuring

Live, both tools now scroll the page a screenful at a time to the end and
back to the top before they measure, so the person who installed a window
sees it look; walk: false measures without moving. The result says
walked: { screenfuls, atEnd, ms } when it happened, which is what makes two
runs that disagree on a lazy-loading page explicable. Headless ignores the
flag with a note; an app older than 0.41.0 answers the first page-wise
scroll with a 400 and gets a note instead of a walk. E2E: the walk on
tall.html reaches the end in a handful of screenfuls, leaves the page at the
top, and changes no number; the skill and README say one sentence each.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Verification sweep and the watch

**Files:** none modified unless the sweep finds something.

- [ ] **Step 1: Full gates**

Run, in order: `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build && npx playwright test`.
Expected: all green except the three pre-existing desk-state pixel failures (`fit-cap.spec:43`, `onion-skin.spec:96,116`), which fail identically on `main` and are not this branch's. Anything else red is this branch's to fix before the review.

- [ ] **Step 2: Watch a walk on two real pages (spec §6: the dwell, and animating pages)**

This step drives the developer's **real** Obsrv (it launches it if closed and takes over its window). **Ask the user before running it**; the e2e harness never touches that app, but this does. The session's own `obsrv` MCP server runs the *published* package, not the working tree, so it cannot exercise the walk — use a throwaway client against the built server instead. Write this to the repo root as `walk-probe.mjs` (untracked; delete it afterwards; never stage it):

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const url = process.argv[2]
const client = new Client({ name: 'walk-probe', version: '0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['bin/obsrv-mcp.js'], cwd: process.cwd() }))
const t0 = Date.now()
const r = await client.callTool({ name: 'obsrv_audit', arguments: { url } }, undefined, { timeout: 120_000 })
const m = r.structuredContent ?? {}
console.log(
  JSON.stringify({
    mode: m.mode,
    walked: m.walked,
    targets: m.summary?.targets?.count,
    text: m.summary?.text?.count,
    pageHeight: m.pageHeight,
    notes: m.notes,
    totalMs: Date.now() - t0,
  }),
)
await client.close()
```

Run, after `npm run build`:

```bash
node walk-probe.mjs https://usekolo.app/
```

```bash
node walk-probe.mjs https://www.ojustudio.com/
```

Record in the task report, for each: `walked.screenfuls`, `walked.ms`, `walked.ms / screenfuls`, `targets`, `text`, `pageHeight`, `notes`. usekolo is the correctness case: expect `targets` ≈ 37 and `text` ≈ 173 (the walked numbers from the spec's table), not 30/157. ojustudio animates continuously: if `walked.ms / screenfuls` is far above the 350 ms dwell plus a scroll round-trip (say over 1,500 ms a screenful), each `scroll` is paying a full settle on a page that never goes quiet — report it as a finding for the user; do not change timeouts in this task. State whether 350 ms reads as watching or as flicker; do not change `WALK_DWELL_MS` — that is the user's call.

Then `rm walk-probe.mjs`.

- [ ] **Step 3: No commit unless Step 1 needed a fix.**
