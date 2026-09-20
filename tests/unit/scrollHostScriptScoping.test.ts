import { describe, expect, it, afterAll } from 'vitest'
import type { Browser, CDPSession, Page } from 'playwright'
import { chromium } from 'playwright'
import { SCROLL_HOST_SCRIPT } from '../../src/shared/scrollHost'

/**
 * `chore-capture-adds-page-globals`: `SCROLL_HOST_SCRIPT` is a page's own
 * source, evaluated at the top level of `executeJavaScript` — so every name
 * it declares (`findScroller`, `shadowElements`, ...) lands in the page's
 * real, persistent global lexical environment, exactly as if the page's own
 * `<script>` had declared it. A page whose own script already used one of
 * those names with `const`/`let`/`function` makes the NEXT
 * `executeJavaScript` that redeclares it throw `SyntaxError: Identifier
 * '<name>' has already been declared` — before any of that call's own code
 * runs.
 *
 * `LINT_SCRIPT`/`AUDIT_SCRIPT`/`WALK_STEP_SCRIPT` (shared/lint.ts,
 * shared/audit.ts, shared/scrollHost.ts) already wrap `SCROLL_HOST_SCRIPT`
 * inside an outer `(() => { ... })()`, which scopes its declarations to that
 * function rather than the page's top level. `cli/main.ts`'s full-page
 * capture was the one caller that concatenated `SCROLL_HOST_SCRIPT` at the
 * true top level instead — this test pins the fix by exercising the exact
 * mechanism, not by reading the source for a matching bracket.
 *
 * No Electron: `webContents.executeJavaScript` is Chromium's CDP
 * `Runtime.evaluate` under the hood, so a headless `playwright-core` page
 * with a direct CDP session reproduces the identical persistent-global-
 * lexical-environment behaviour. Confirmed empirically before writing this
 * test: `page.evaluate` (Playwright's own API, `Runtime.callFunctionOn`)
 * does NOT reproduce the collision, and CDP `Runtime.evaluate` with
 * `replMode: true` deliberately tolerates redeclaration (that's what makes a
 * DevTools console usable) — only plain `Runtime.evaluate` collides, which is
 * the mode `executeJavaScript` uses.
 */

let browser: Browser | undefined

async function pageWithCdp(script: string): Promise<{ page: Page; cdp: CDPSession }> {
  browser ??= await chromium.launch()
  const page = await browser.newPage()
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const cdp = await page.context().newCDPSession(page)
  return { page, cdp }
}

/** Runs `expression` the way `executeJavaScript` does: no replMode, so a redeclaration collides. */
async function evaluate(cdp: CDPSession, expression: string): Promise<{ threw: string | null; value: unknown }> {
  const r = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
    exceptionDetails?: { exception?: { description?: string } }
    result: { value?: unknown }
  }
  if (r.exceptionDetails) return { threw: r.exceptionDetails.exception?.description ?? 'thrown, no description', value: undefined }
  return { threw: null, value: r.result.value }
}

/** `cli/main.ts`'s template, before this fix: `SCROLL_HOST_SCRIPT` concatenated at the page's true top level. */
function unscoped(body: string): string {
  return `${SCROLL_HOST_SCRIPT}\n;(() => {${body}})()`
}

/** After this fix, matching `LINT_SCRIPT`/`AUDIT_SCRIPT`/`WALK_STEP_SCRIPT`'s existing pattern. */
function scoped(body: string): string {
  return `(() => {\n${SCROLL_HOST_SCRIPT}\nreturn (() => {${body}})()\n})()`
}

afterAll(async () => {
  await browser?.close()
})

describe('SCROLL_HOST_SCRIPT no longer lands on the page’s own top level', () => {
  it('control: the unscoped form collides with a page that already declared one of its names', async () => {
    const { cdp } = await pageWithCdp('const shadowElements = 1;')
    const got = await evaluate(cdp, unscoped('return 1'))
    expect(got.threw, 'the unscoped form should still collide, or this control proves nothing').toMatch(
      /Identifier 'shadowElements' has already been declared/,
    )
  })

  it('the scoped (fixed) form does not collide with the same page', async () => {
    const { cdp } = await pageWithCdp('const shadowElements = 1;')
    const got = await evaluate(cdp, scoped('return 1'))
    expect(got.threw).toBeNull()
    expect(got.value).toBe(1)
  })

  it('another of SCROLL_HOST_SCRIPT’s names collides too, not just shadowElements', async () => {
    // `findScroller` is a plainer, more likely name for a page's own script
    // to pick than `shadowElements` — checked separately so the fix isn't
    // shown working for one conveniently-obscure identifier only.
    const { cdp } = await pageWithCdp('const findScroller = 1;')
    const unscopedResult = await evaluate(cdp, unscoped('return 1'))
    expect(unscopedResult.threw).toMatch(/Identifier 'findScroller' has already been declared/)

    const { cdp: cdp2 } = await pageWithCdp('const findScroller = 1;')
    const scopedResult = await evaluate(cdp2, scoped('return 1'))
    expect(scopedResult.threw).toBeNull()
  })

  it('scoped, run twice on the same page, still does not collide with itself', async () => {
    // The fix has to survive repeat calls too — the full-page capture's own
    // band loop is not the only caller in a session, and `SCROLL_HOST_SCRIPT`
    // is evaluated fresh by LINT_SCRIPT/AUDIT_SCRIPT/WALK_STEP_SCRIPT on the
    // same page across a session already; this just confirms the pattern
    // this fix now matches actually has that property.
    const { cdp } = await pageWithCdp('void 0;')
    const first = await evaluate(cdp, scoped('return 1'))
    const second = await evaluate(cdp, scoped('return 2'))
    expect(first.threw).toBeNull()
    expect(second.threw).toBeNull()
    expect(second.value).toBe(2)
  })

  it('the fixed form still returns real answers on an ordinary page (matches cli/main.ts’s own shape)', async () => {
    const { cdp } = await pageWithCdp(`
      document.documentElement.style.height = '3000px'
      document.body.style.height = '3000px'
    `)
    const got = await evaluate(
      cdp,
      scoped(`
        const root = document.scrollingElement
        const rootScrolls = !!root && root.scrollHeight > root.clientHeight + 1
        return { rootScrolls, found: false }
      `),
    )
    expect(got.threw).toBeNull()
    expect(got.value).toEqual({ rootScrolls: true, found: false })
  })
})
