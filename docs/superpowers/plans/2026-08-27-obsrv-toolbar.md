# Obsrv Toolbar Cleanup and Solo-Target View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Obsrv's single 44px toolbar with two purpose-separated strips, move rare controls behind an overflow menu, adopt `lucide-react` icons, and add a `Both | Target` toggle that hides the native pane so the target render can take the whole window.

**Architecture:** The functional half lands first and independently — a `panes` store slice, a `setNativeVisible` IPC that lets main derive the native `WebContentsView`'s visibility from mode *and* panes in one place, and the agent-control surface for it. The visual half follows: four small presentational components (`Icon`, `Select`, `Segmented`, `OverflowMenu`) that `Toolbar` composes into two rows, then the CSS. Splitting it this way keeps the suite green at every commit — the toggle ships into the *existing* toolbar in Task 3 and simply moves in Task 7.

**Tech Stack:** Electron 43, React 19, zustand 5, TypeScript 5, `lucide-react` (new, devDependency), Vitest 3, Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-08-27-obsrv-toolbar-design.md`

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/renderer/src/components/Icon.tsx` | The eight lucide icons the chrome uses, pre-configured at 16px / 1.5px stroke / `aria-hidden`. One import site for the library. |
| `src/renderer/src/components/Select.tsx` | A styled select shell: our surface and chevron, a real `<select>` kept underneath for the native popup and keyboard behaviour. |
| `src/renderer/src/components/Segmented.tsx` | A segmented button group (`1:1 \| Fit`, `Both \| Target`). Owns `aria-pressed` and the group role. |
| `src/renderer/src/components/OverflowMenu.tsx` | The `⋮` popover: open state, outside-click and Escape dismissal, focus return. |

**Modified**

| File | Change |
|---|---|
| `src/renderer/src/state/store.ts` | `panes` state + `setPanes`. |
| `src/renderer/src/App.tsx` | Solo-target layout; pushes `setNativeVisible`; applies `panes` from agent patches. |
| `src/renderer/src/components/Toolbar.tsx` | Rewritten as two rows composing the four new components. |
| `src/renderer/src/styles.css` | Two-row chrome, 30px controls, type scale, `--chrome-3`; the blanket `.toolbar button` rule deleted. |
| `src/shared/api.ts`, `src/shared/ipc.ts`, `src/preload/app.ts` | `setNativeVisible` channel and bridge. |
| `src/shared/control.ts` | `AgentPanes`, `panes` on the patch / UI state / status, `panesApplyError`, `setPanes` command. |
| `src/main/ipc.ts` | `applyNativeVisibility` derivation; `TOOLBAR_H` 44 → 82. |
| `src/main/controlServer.ts` | `setPanes` case. |
| `src/mcp/server.ts` | `panes` on `obsrv_drive` input and the live status passthrough. |
| `tests/e2e/launch.ts` | `openOverflow` helper shared by the specs whose controls moved. |

**Test files touched:** `tests/unit/store.test.ts`, `tests/unit/calibration.test.ts`, `tests/e2e/controls.spec.ts`, `tests/e2e/panes.spec.ts`, `tests/e2e/image-mode.spec.ts`, `tests/e2e/update.spec.ts`, `tests/e2e/live-drive.spec.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/fit-pan.spec.ts`, plus new `tests/e2e/solo-target.spec.ts`.

---

### Task 1: The `panes` store slice

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `tests/unit/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/store.test.ts`:

```ts
describe('panes', () => {
  it('starts showing both panes', () => {
    expect(useStore.getState().panes).toBe('both')
  })

  it('switches to the target alone and back', () => {
    useStore.getState().setPanes('target')
    expect(useStore.getState().panes).toBe('target')
    useStore.getState().setPanes('both')
    expect(useStore.getState().panes).toBe('both')
  })

  it('does not disturb the agent highlight', () => {
    useStore.getState().showAgentHighlight({ x: 0, y: 0, width: 4, height: 4, durationMs: 1000 })
    useStore.getState().setPanes('target')
    expect(useStore.getState().agentHighlight).not.toBeNull()
  })
})
```

The third case is the point of the slice: hiding the native pane does not re-raster the target, so unlike `setPreset` it must leave a highlight's target-pixel rect alone.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/unit/store.test.ts -t panes
```

Expected: FAIL — `panes` is undefined and `setPanes` is not a function.

- [ ] **Step 3: Add the state**

In `src/renderer/src/state/store.ts`, after the `Surround` type (around line 25):

```ts
/** Whether the native pane shares the window, or the target render has it alone. */
export type Panes = 'both' | 'target'
```

In `interface AppState`, after `viewMode: ViewMode`:

```ts
  /**
   * Native-only is deliberately not offered: that is a browser, and the user
   * has one. Not persisted to settings — a per-look toggle like `viewMode`.
   */
  panes: Panes
```

In the actions block of `AppState`, after `setViewMode(v: ViewMode): void`:

```ts
  setPanes(p: Panes): void
```

In the store body, after `viewMode: '1:1',`:

```ts
  panes: 'both',
```

And after `setViewMode: viewMode => set({ viewMode }),`:

```ts
  // No `agentHighlight: null` here, unlike setPreset: hiding a pane does not
  // re-raster the target, so the highlight still marks the pixels it marked.
  setPanes: panes => set({ panes }),
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/unit/store.test.ts -t panes
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/src/state/store.ts tests/unit/store.test.ts
git commit -m "feat(store): add the panes slice for the solo-target view"
```

---

### Task 2: Main derives the native view's visibility

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/app.ts`, `src/main/ipc.ts`
- Test: `tests/e2e/solo-target.spec.ts` (create)

The native pane is an OS-level `WebContentsView`, not DOM. Unmounting `NativeSlot` stops `setNativeBounds` but leaves the view visible at its last rectangle, floating over the target pane. Main needs an explicit signal — and because `setMode` already owns visibility for image mode, the two inputs must be combined in one place rather than each calling `native.setVisible` and clobbering the other.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/solo-target.spec.ts`:

```ts
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

let app: ElectronApplication
let page: Page

/** Asks main whether the native WebContentsView is currently on screen. */
const nativeVisible = () =>
  app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('setNativeVisible hides and restores the OS-level view', async () => {
  expect(await nativeVisible()).toBe(true)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(false))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(true))
  await expect.poll(nativeVisible).toBe(true)
})

test('image mode and panes do not clobber each other', async () => {
  // Hidden by panes, then image mode ends: still hidden, because panes says so.
  await page.evaluate(() => (window as any).obsrv.setNativeVisible(false))
  await page.evaluate(() => (window as any).obsrv.setMode('image'))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setMode('url'))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(true))
  await expect.poll(nativeVisible).toBe(true)
})
```

The second test is the whole reason for the derivation: with two independent callers of `native.setVisible`, leaving image mode would reveal a pane the panes toggle had hidden.

- [ ] **Step 2: Confirm the test hook exposes `native`**

```bash
grep -n "native" src/main/testHooks.ts
```

If `native` is not on the published `__obsrv` object, add it — find the object literal `boot()` assigns to `globalThis.__obsrv` and include `native` alongside the existing entries. The hook is test-only (`OBSRV_TEST`), so it may expose the pane directly.

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run build && npx playwright test tests/e2e/solo-target.spec.ts
```

Expected: FAIL — `obsrv.setNativeVisible is not a function`.

- [ ] **Step 4: Add the channel**

In `src/shared/ipc.ts`, after `setNativeBounds`:

```ts
  setNativeVisible: 'obsrv:set-native-visible',
```

In `src/shared/api.ts`, after `setNativeBounds(rect: Rect): void`:

```ts
  /**
   * Whether the native pane is on screen. It is an OS-level overlay, so
   * unmounting its slot is not enough to hide it. Main combines this with the
   * mode; the renderer never speaks to the view directly.
   */
  setNativeVisible(visible: boolean): void
```

In `src/preload/app.ts`, after the `setNativeBounds` line:

```ts
  setNativeVisible: visible => ipcRenderer.send(IPC.setNativeVisible, visible),
```

- [ ] **Step 5: Derive visibility in main**

In `src/main/ipc.ts`, replace the `--- mode ---` block:

```ts
  // --- mode -----------------------------------------------------------------
  ipcMain.on(IPC.setMode, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const mode = parseMode(raw)
    if (!mode) return
    const live = mode === 'url'
    native.setVisible(live)
    bus.setEnabled(live)
  })
```

with:

```ts
  // --- native visibility ----------------------------------------------------
  // Two independent inputs decide whether the native view is on screen: image
  // mode (the left pane is drawn in the renderer instead) and the panes toggle
  // (solo target). Each calling `native.setVisible` directly would clobber the
  // other — leaving image mode would reveal a pane the toggle had hidden — so
  // both write an input here and the visibility is derived in one place.
  let modeIsLive = true
  let panesShowNative = true
  const applyNativeVisibility = (): void => {
    native.setVisible(modeIsLive && panesShowNative)
  }

  ipcMain.on(IPC.setMode, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const mode = parseMode(raw)
    if (!mode) return
    modeIsLive = mode === 'url'
    applyNativeVisibility()
    // The sync bus follows the *mode* only. In solo target the native pane is
    // still loaded and still the navigation master — disabling the bus there
    // would break the URL bar, back/forward and link clicks in exactly the
    // view where the target pane is the only thing on screen.
    bus.setEnabled(modeIsLive)
  })

  ipcMain.on(IPC.setNativeVisible, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    if (typeof raw !== 'boolean') return
    panesShowNative = raw
    applyNativeVisibility()
  })
```

- [ ] **Step 6: Run it and watch it pass**

```bash
npm run build && npx playwright test tests/e2e/solo-target.spec.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/app.ts src/main/ipc.ts tests/e2e/solo-target.spec.ts
git commit -m "feat(main): derive native pane visibility from mode and panes together"
```

---

### Task 3: The solo-target layout, and a toggle in the existing toolbar

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/styles.css`
- Test: `tests/e2e/solo-target.spec.ts`

The toggle goes into today's toolbar so the behaviour ships and is tested before the layout is rebuilt. Task 7 moves it into row 2 unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/solo-target.spec.ts`:

```ts
test('the target pane takes the whole window and gives it back', async () => {
  const paneWidth = () =>
    page.evaluate(() => (document.querySelector('.target-pane') as HTMLElement).getBoundingClientRect().width)
  const shared = await paneWidth()

  await page.click('.panes-target')
  await expect(page.locator('.native-slot')).toHaveCount(0)
  await expect.poll(nativeVisible).toBe(false)
  await expect.poll(paneWidth).toBeGreaterThan(shared * 1.8)

  await page.click('.panes-both')
  await expect(page.locator('.native-slot')).toHaveCount(1)
  await expect.poll(nativeVisible).toBe(true)
  await expect.poll(paneWidth).toBeLessThan(shared * 1.2)
})

test('the native view is repositioned before it is shown again', async () => {
  await page.click('.panes-target')
  await expect.poll(nativeVisible).toBe(false)
  await page.click('.panes-both')
  await expect.poll(nativeVisible).toBe(true)

  const [slot, view] = await Promise.all([
    page.evaluate(() => {
      const r = (document.querySelector('.native-slot') as HTMLElement).getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) }
    }),
    app.evaluate(() => (globalThis as any).__obsrv.native.getBounds()),
  ])
  expect(view.width).toBe(slot.width)
  expect(view.x).toBe(slot.x)
  expect(view.y).toBe(slot.y)
})
```

The second test guards an ordering hazard: React runs child effects before parent effects, so `NativeSlot`'s bounds push must land before `App`'s `setNativeVisible(true)`. If that ever inverts, the view flashes at a stale rectangle.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run build && npx playwright test tests/e2e/solo-target.spec.ts
```

Expected: FAIL — no element matches `.panes-target`.

- [ ] **Step 3: Render the layout**

In `src/renderer/src/App.tsx`, add to the imports from the store:

```ts
const panes = useStore(s => s.panes)
```

Add an effect beside the existing `setMode` one:

```ts
  // The native pane is an OS-level overlay: unmounting its slot below leaves
  // the view on screen, so main is told explicitly. On the way back, React
  // runs NativeSlot's mount effect (which pushes bounds) before this parent
  // effect, so the view is positioned before it is revealed.
  useEffect(() => {
    window.obsrv.setNativeVisible(panes === 'both')
  }, [panes])
```

Replace the `.panes` block:

```tsx
        <div className="panes">
          {mode === 'image' && image ? (
```

with:

```tsx
        <div className="panes" data-panes={panes}>
          {panes === 'both' && (mode === 'image' && image ? (
```

and close that conditional after `<NativeSlot />`:

```tsx
          ) : (
            <NativeSlot />
          ))}
```

- [ ] **Step 4: Add the toggle to the toolbar**

In `src/renderer/src/components/Toolbar.tsx`, add below the `VIEWS` constant:

```tsx
/** Native-only is not offered: that is a browser, and the user has one. */
const PANES: { id: Panes; label: string; title: string }[] = [
  { id: 'both', label: 'Both', title: 'Native and target side by side' },
  { id: 'target', label: 'Target', title: 'The target render alone, full width' },
]
```

Import `type Panes` from `../state/store`, and read the slice beside `viewMode`:

```tsx
  const panes = useStore(s => s.panes)
  const setPanes = useStore(s => s.setPanes)
```

Insert immediately after the `.view-control` group:

```tsx
      <div className="panes-control" role="group" aria-label="Panes">
        {PANES.map(p => (
          <button
            key={p.id}
            type="button"
            className={`panes-${p.id}`}
            title={p.title}
            aria-pressed={panes === p.id}
            onClick={() => setPanes(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 5: Style it, and drop the border with nothing beside it**

In `src/renderer/src/styles.css`, beside the `.surround-control` rules:

```css
/* Same segmented treatment as the surround control: weight, never hue. */
.panes-control { display: flex; border: 1px solid var(--line); border-radius: 4px; }
.panes-control button {
  width: auto;
  padding: 0 8px;
  border: 0;
  border-right: 1px solid var(--line);
  border-radius: 0;
  white-space: nowrap;
}
.panes-control button:last-child { border-right: 0; }
.panes-control button[aria-pressed='true'] { border-color: var(--text-0); background: var(--chrome-1); }

/* Nothing sits to the target pane's left in solo view, so the divider goes. */
.panes[data-panes='target'] .target-pane { border-left: 0; }
```

- [ ] **Step 6: Run it and watch it pass**

```bash
npm run build && npx playwright test tests/e2e/solo-target.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full e2e suite**

```bash
npx playwright test
```

Expected: PASS. `.pane { flex: 1 1 50% }` fills the row with a single child, so no other spec's geometry moves.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Toolbar.tsx src/renderer/src/styles.css tests/e2e/solo-target.spec.ts
git commit -m "feat: add a Both/Target toggle that gives the target pane the window"
```

---

### Task 4: Prove scroll still mirrors to the hidden pane

**Files:**
- Test: `tests/e2e/solo-target.spec.ts`

The spec names this as the one real risk: Chromium may background-throttle a hidden `WebContentsView`, which would stall the scroll mirror and make solo target silently lie about where the page is. Scroll sync is driven by an explicit `scrollTo` from a preload rather than by rAF, so it should survive — but "should" is not a test.

- [ ] **Step 1: Find how existing specs drive and read a scroll**

```bash
grep -n "scroll" tests/e2e/panes.spec.ts | head -20
```

Reuse that spec's fixture URL and its helper for reading the native pane's offset. Do not invent a new mechanism.

- [ ] **Step 2: Write the test**

Append to `tests/e2e/solo-target.spec.ts`, substituting the fixture and offset helper found in Step 1:

```ts
test('a scroll in solo target still reaches the hidden native pane', async () => {
  await page.click('.panes-both')
  await page.evaluate(() => (window as any).obsrv.navigate('<FIXTURE_URL_FROM_PANES_SPEC>'))
  await expect.poll(nativeVisible).toBe(true)

  await page.click('.panes-target')
  await expect.poll(nativeVisible).toBe(false)

  // Scroll the target pane the way an agent's `scroll` does.
  await app.evaluate(async () => {
    await (globalThis as any).__obsrv.applyScroll({ x: 0, y: 600 })
  })

  // The hidden native pane must have followed. If this fails, the view is
  // being background-throttled; see the fallback in Step 4.
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.webContents.executeJavaScript('window.scrollY')))
    .toBeGreaterThan(400)
})
```

If `__obsrv` exposes no `applyScroll`, drive the scroll through the control server exactly as `tests/e2e/live-drive.spec.ts` does.

- [ ] **Step 3: Run it**

```bash
npm run build && npx playwright test tests/e2e/solo-target.spec.ts -g "hidden native pane"
```

Expected: PASS.

- [ ] **Step 4: Only if it fails — apply the fallback**

Do not weaken the test. Instead, in `src/main/ipc.ts`, replace `applyNativeVisibility` so the view is parked beneath the target pane rather than hidden:

```ts
  // Chromium throttles a hidden WebContentsView, which stalls the scroll
  // mirror, so solo target parks the view under the target pane's canvas
  // instead of hiding it: still composited, never seen.
  const applyNativeVisibility = (): void => {
    if (!modeIsLive) {
      native.setVisible(false)
      return
    }
    native.setVisible(true)
    if (!panesShowNative) native.setBounds({ ...native.getBounds(), x: -20_000 })
  }
```

Then re-run Step 3, re-run the Task 3 tests (the bounds assertion will need the restore path checked), and record the outcome in the spec's "Risk, and how it is settled" section.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/solo-target.spec.ts
git commit -m "test: scroll still mirrors to the native pane hidden by solo target"
```

---

### Task 5: `panes` on the agent-control surface

**Files:**
- Modify: `src/shared/control.ts`, `src/main/controlServer.ts`, `src/renderer/src/App.tsx`, `src/mcp/server.ts`
- Test: `tests/unit/control.test.ts` (or wherever `viewModeApplyError` is tested — find it), `tests/e2e/live-drive.spec.ts`

- [ ] **Step 1: Find the existing validator test**

```bash
grep -rln "viewModeApplyError\|parseControlStatus" tests/
```

Add the new cases to the file that already covers those.

- [ ] **Step 2: Write the failing tests**

```ts
describe('panesApplyError', () => {
  it('accepts both and target', () => {
    expect(panesApplyError('both')).toBeNull()
    expect(panesApplyError('target')).toBeNull()
  })
  it('rejects anything else', () => {
    expect(panesApplyError('native')).toMatch(/setPanes payload/)
    expect(panesApplyError(undefined)).toMatch(/setPanes payload/)
  })
})

describe('parseControlStatus', () => {
  const base = { version: '0.8.0', url: 'https://x/', presetId: '1080p-24', profileId: 'reference', viewMode: '1:1', mode: 'url' }

  it('reads panes when present', () => {
    expect(parseControlStatus({ ...base, panes: 'target' })?.panes).toBe('target')
  })

  // Version skew is real: the MCP server is npm-installed and the app is a
  // DMG, so a new server routinely talks to an older app. An absent field
  // must default, never fail the whole status.
  it('defaults panes to both when an older app omits it', () => {
    expect(parseControlStatus(base)?.panes).toBe('both')
  })

  it('still rejects a malformed panes', () => {
    expect(parseControlStatus({ ...base, panes: 'native' })).toBeNull()
  })
})
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run tests/unit -t panes
```

Expected: FAIL — `panesApplyError` is not exported.

- [ ] **Step 4: Extend the control contract**

In `src/shared/control.ts`, after the `AgentViewMode` type:

```ts
/** Whether the native pane shares the window — mirrors the renderer store's Panes. */
export type AgentPanes = 'both' | 'target'
```

Add to `AgentUiState`, after `viewMode: AgentViewMode`:

```ts
  panes: AgentPanes
```

Add to `AgentApplyPatch`, after `viewMode?: AgentViewMode`:

```ts
  panes?: AgentPanes
```

Add `'setPanes'` to `CONTROL_COMMANDS`, after `'setViewMode'`.

Beside `viewModeApplyError`:

```ts
export function panesApplyError(v: unknown): string | null {
  return v === 'both' || v === 'target' ? null : `setPanes payload must be { panes: 'both' | 'target' }`
}
```

Replace `parseControlStatus`:

```ts
export function parseControlStatus(raw: unknown): ControlStatus | null {
  if (!isRecord(raw)) return null
  const { version, url, presetId, profileId, viewMode, mode } = raw
  if (typeof version !== 'string' || typeof url !== 'string') return null
  if (typeof presetId !== 'string' || typeof profileId !== 'string') return null
  if (viewMode !== '1:1' && viewMode !== 'fit') return null
  if (mode !== 'url' && mode !== 'image') return null
  // An app older than this field is common — the MCP server ships on npm and
  // the app ships as a DMG, so they update independently. Absent defaults;
  // present-but-wrong is still a malformed status.
  const panes = raw.panes ?? 'both'
  if (panes !== 'both' && panes !== 'target') return null
  return { version, url, presetId, profileId, viewMode, mode, panes }
}
```

- [ ] **Step 5: Handle the command**

In `src/main/controlServer.ts`, import `panesApplyError` alongside `viewModeApplyError`, and add after the `setViewMode` case:

```ts
      case 'setPanes': {
        const err = panesApplyError(payload.panes)
        if (err) return reply(400, { error: err })
        const panes = payload.panes as 'both' | 'target'
        return this.applyAndConfirm({ panes }, s => s.panes === panes)
      }
```

- [ ] **Step 6: Apply it in the renderer**

In `src/renderer/src/App.tsx`, inside the `onAgentApply` callback, after the `viewMode` line:

```ts
      if (patch.panes !== undefined) s.setPanes(patch.panes)
```

And add `panes` to the `reportUiState` call and its dependency array:

```ts
  useEffect(() => {
    window.obsrv.reportUiState({ presetId, profileId, viewMode, panes, mode, targetBounds, canvasBounds })
  }, [presetId, profileId, viewMode, panes, mode, targetBounds, canvasBounds])
```

Then find where main builds the `status()` object from the mirrored report and add `panes` there:

```bash
grep -n "viewMode" src/main/ipc.ts src/main/index.ts src/main/context.ts
```

- [ ] **Step 7: Expose it on `obsrv_drive`**

In `src/mcp/server.ts`, beside the `viewMode` field of the drive input schema (around line 311):

```ts
  panes: z.enum(['both', 'target']).optional().describe("Show both panes, or give the target render the whole window ('target'). Solo target is usually what you want before a capture."),
```

Add to the input type (around line 746):

```ts
    panes?: 'both' | 'target'
```

After the `viewMode` apply block (around line 773):

```ts
      if (input.panes !== undefined) {
        await controlCall(live.info, 'setPanes', { panes: input.panes }, LIVE_APPLY_TIMEOUT_MS)
      }
```

Add `panes` to the status shape at line 378 (`panes: z.string()`), to the passthrough at line 561 (`panes: status.panes,`), and extend the order sentence at line 721 to read `preset → profile → viewMode → panes → pixelExact → reload → …`.

- [ ] **Step 8: Add the live-drive e2e**

Append to `tests/e2e/live-drive.spec.ts`, following the file's existing `controlCall` helper:

```ts
test('setPanes gives the target the window and reports it in status', async () => {
  const applied = await controlCall('setPanes', { panes: 'target' })
  expect(applied.applied).toBe(true)
  expect(applied.panes).toBe('target')
  await expect(page.locator('.native-slot')).toHaveCount(0)

  const back = await controlCall('setPanes', { panes: 'both' })
  expect(back.panes).toBe('both')
  await expect(page.locator('.native-slot')).toHaveCount(1)
})

test('setPanes refuses an unknown value', async () => {
  await expect(controlCall('setPanes', { panes: 'native' })).rejects.toThrow(/setPanes payload/)
})
```

- [ ] **Step 9: Run everything**

```bash
npm run typecheck && npx vitest run tests/unit && npm run build && npx playwright test
```

Expected: PASS throughout.

- [ ] **Step 10: Commit**

```bash
git add src/shared/control.ts src/main/controlServer.ts src/renderer/src/App.tsx src/mcp/server.ts tests/
git commit -m "feat(agent): let obsrv_drive set panes, and report it in status"
```

---

### Task 6: The icon set

**Files:**
- Create: `src/renderer/src/components/Icon.tsx`
- Modify: `package.json`

- [ ] **Step 1: Install the library as a devDependency**

```bash
npm i -D lucide-react
```

`electron.vite.config.ts` applies `externalizeDepsPlugin()` to main and preload only, so the renderer bundles its imports — `out/` carries the eight icons inline and resolves nothing at runtime. A runtime dependency would ship it in the `getobsrv` tarball, which is CLI and MCP server and never loads a renderer.

- [ ] **Step 2: Write the component**

Create `src/renderer/src/components/Icon.tsx`:

```tsx
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  EllipsisVertical,
  RotateCw,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react'

/**
 * The chrome's icons, in one place so size, stroke and the accessibility
 * treatment cannot drift between call sites. Every icon is decorative: the
 * control around it carries the `aria-label` and `title`.
 *
 * Lucide draws on a 24px grid at 1.5px stroke, which is already what the UI
 * style spec asks for — no per-icon tuning.
 */
const ICONS = {
  back: ArrowLeft,
  forward: ArrowRight,
  reload: RotateCw,
  overflow: EllipsisVertical,
  close: X,
  sliders: SlidersHorizontal,
  gear: Settings,
  chevron: ChevronDown,
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} aria-hidden="true" focusable="false" />
}
```

- [ ] **Step 3: Verify it compiles and bundles**

```bash
npm run typecheck && npm run build
```

Expected: both succeed. `Icon.tsx` is unused until Task 7, so nothing renders yet — that is deliberate; it lands as its own reviewable commit.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/Icon.tsx
git commit -m "feat(ui): add the lucide icon set the chrome will use"
```

---

### Task 7: Two strips, an overflow menu, and the control primitives

**Files:**
- Create: `src/renderer/src/components/Select.tsx`, `src/renderer/src/components/Segmented.tsx`, `src/renderer/src/components/OverflowMenu.tsx`
- Modify: `src/renderer/src/components/Toolbar.tsx`
- Test: `tests/e2e/toolbar.spec.ts` (create)

- [ ] **Step 1: Write `Segmented.tsx`**

```tsx
/** One button of a segmented group. `className` is preserved for test hooks. */
export interface SegmentedOption<T extends string> {
  id: T
  label: string
  title: string
  className?: string
}

export interface SegmentedProps<T extends string> {
  className: string
  ariaLabel: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
}

/**
 * A segmented button group. The pressed state is weight and a fill step,
 * never hue — the UI style spec's rule, and the reason this is a shared
 * component rather than two hand-rolled groups that could drift apart.
 */
export function Segmented<T extends string>({ className, ariaLabel, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          className={o.className}
          title={o.title}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write `Select.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export interface SelectProps {
  /** Kept as a test and style hook, e.g. `preset-select`. */
  className: string
  value: string
  /** What the shell shows — the chosen option's label, not its id. */
  label: string
  ariaLabel: string
  onChange: (v: string) => void
  /** `<option>` and `<optgroup>` elements. */
  children: ReactNode
}

/**
 * Our surface with the platform's behaviour: the shell paints the label and
 * chevron, and a real `<select>` sits transparent on top so the native popup,
 * keyboard handling and accessibility come for free. The native control keeps
 * a real bounding box (opacity, not `display: none`), so Playwright's
 * `selectOption` drives it exactly as before.
 */
export function Select({ className, value, label, ariaLabel, onChange, children }: SelectProps) {
  return (
    <div className="select-shell">
      <span className="select-label">{label}</span>
      <span className="select-chevron">
        <Icon name="chevron" size={14} />
      </span>
      <select className={className} value={value} aria-label={ariaLabel} onChange={e => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  )
}
```

- [ ] **Step 3: Write `OverflowMenu.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * The `⋮` popover holding the rare controls.
 *
 * It opens *down and to the left of the right edge*, which is not cosmetic:
 * the native pane is an OS-level `WebContentsView` that covers anything the
 * renderer paints over it, so a menu that reached the left half of the window
 * would be invisible. Right-aligned and 200px wide, it lands over the target
 * pane, which is ordinary renderer DOM. The window's `minWidth` is 900, so
 * the target pane is never narrower than ~450px and the menu always fits.
 */
export function OverflowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = (): void => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="overflow" ref={ref}>
      <button
        ref={buttonRef}
        className="icon-button overflow-button"
        type="button"
        title="More"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="overflow" />
      </button>
      {open && (
        <div className="overflow-menu" role="menu">
          {children(close)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rewrite `Toolbar.tsx`**

Replace the whole `return (…)` block. Everything above it — the store reads, `agentActive`, `toggleAgent`, the draft sync, `submit` — stays exactly as it is, plus the `panes` reads added in Task 3.

```tsx
  return (
    <div className="chrome">
      <div className="chrome-row chrome-browse">
        <button className="icon-button" type="button" title="Back" aria-label="Back" onClick={() => window.obsrv.back()}>
          <Icon name="back" />
        </button>
        <button className="icon-button" type="button" title="Forward" aria-label="Forward" onClick={() => window.obsrv.forward()}>
          <Icon name="forward" />
        </button>
        <button className="icon-button" type="button" title="Reload" aria-label="Reload" onClick={() => window.obsrv.reload()}>
          <Icon name="reload" />
        </button>

        <form className="url-form" onSubmit={submit}>
          <input
            ref={inputRef}
            value={draft}
            readOnly={readOnly}
            spellCheck={false}
            placeholder="Enter a URL, or drop a PNG"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setDraft(barText)
            }}
          />
        </form>

        {/* The only region that grows and shrinks, so appearing status
            reflows nothing but itself — the old toolbar shoved every
            control right when a load error arrived. */}
        <div className="status-cluster">
          {mode === 'image' && (
            <button
              className="icon-button close-image"
              type="button"
              title="Back to the live page"
              aria-label="Back to the live page"
              onClick={() => setMode('url')}
            >
              <Icon name="close" />
            </button>
          )}
          {loading && <span className="muted">loading…</span>}
          {error && (
            <span className="badge-error" title={error.description}>
              {error.code}
            </span>
          )}
          {viewport.clamped && (
            <span className="warn">
              clamped to {viewport.width}×{viewport.height}
            </span>
          )}
          {update?.status === 'available' && update.latest !== undefined && (
            <button
              className="update-button"
              type="button"
              title={`Obsrv ${update.latest} is available — opens the download page`}
              onClick={() => void window.obsrv.openRelease()}
            >
              v{update.latest} ↓
            </button>
          )}
        </div>

        <OverflowMenu>
          {close => (
            <>
              <label className="menu-row pixel-exact">
                <input
                  type="checkbox"
                  checked={pixelExact}
                  onChange={e => setPixelExact(e.target.checked)}
                />
                Pixel-exact
              </label>
              <button
                className="menu-row toggle-panel"
                type="button"
                role="menuitem"
                aria-pressed={drawer === 'panel'}
                onClick={() => {
                  onTogglePanel()
                  close()
                }}
              >
                <Icon name="sliders" />
                Panel controls
              </button>
              <button
                className="menu-row toggle-settings"
                type="button"
                role="menuitem"
                aria-pressed={drawer === 'settings'}
                onClick={() => {
                  onToggleSettings()
                  close()
                }}
              >
                <Icon name="gear" />
                Settings
              </button>
              <div className="menu-sep" />
              <label className="menu-row agent-toggle">
                <input type="checkbox" checked={agentControl} onChange={toggleAgent} />
                Agent control
              </label>
            </>
          )}
        </OverflowMenu>
      </div>

      <div className="chrome-row chrome-screen">
        <Select
          className="preset-select"
          value={presetId}
          label={presetLabel}
          ariaLabel="Target screen"
          onChange={setPreset}
        >
          <optgroup label="Laptops">
            {SCREEN_PRESETS.filter(p => p.group === 'laptop').map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="Desktops">
            {SCREEN_PRESETS.filter(p => p.group === 'desktop').map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="Mobile">
            {SCREEN_PRESETS.filter(p => p.group === 'mobile').map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <option value={CUSTOM_PRESET_ID}>Custom</option>
        </Select>

        <Segmented
          className="view-control"
          ariaLabel="Target view"
          value={viewMode}
          options={VIEWS.map(v => ({ ...v, className: v.id === 'fit' ? 'view-fit' : 'view-1x' }))}
          onChange={setViewMode}
        />

        <Segmented
          className="panes-control"
          ariaLabel="Panes"
          value={panes}
          options={PANES.map(p => ({ ...p, className: `panes-${p.id}` }))}
          onChange={setPanes}
        />

        <Select
          className="profile-select"
          value={profileId}
          label={profileLabel}
          ariaLabel="Panel profile"
          onChange={setProfile}
        >
          {PANEL_PROFILES.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </Select>

        <div className="surround-control" role="group" aria-label="Pane surround">
          {SURROUNDS.map(s => (
            <button
              key={s.id}
              type="button"
              title={s.label}
              aria-label={s.label}
              aria-pressed={surround === s.id}
              onClick={() => setSurround(s.id)}
            >
              <span className="surround-swatch" style={{ background: s.swatch }} />
            </button>
          ))}
        </div>

        <div className="chrome-spacer" />

        {/* Agent control opens a loopback server, so it is never silently on:
            the chip persists while enabled and brightens for ~3s of activity. */}
        {agentControl && (
          <span className={`agent-activity${agentActive ? ' active' : ''}`}>AGENT</span>
        )}
      </div>
    </div>
  )
```

Add the imports and the two label lookups above the `return`:

```tsx
import { Icon } from './Icon'
import { OverflowMenu } from './OverflowMenu'
import { Segmented } from './Segmented'
import { Select } from './Select'
```

```tsx
  // The shell paints the label itself, so it needs the chosen option's text.
  const presetLabel = SCREEN_PRESETS.find(p => p.id === presetId)?.label ?? 'Custom'
  const profileLabel = PANEL_PROFILES.find(p => p.id === profileId)?.label ?? profileId
```

- [ ] **Step 5: Write the layout test**

Create `tests/e2e/toolbar.spec.ts`:

```ts
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('the chrome is two rows and the screen row holds the screen controls', async () => {
  await expect(page.locator('.chrome-row')).toHaveCount(2)
  for (const sel of ['.preset-select', '.view-control', '.panes-control', '.profile-select', '.surround-control']) {
    await expect(page.locator(`.chrome-screen ${sel}`)).toHaveCount(1)
  }
})

test('the overflow menu opens, closes on Escape, and holds the rare controls', async () => {
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
  await page.click('.overflow-button')
  await expect(page.locator('.overflow-menu')).toHaveCount(1)
  for (const sel of ['.pixel-exact', '.toggle-panel', '.toggle-settings', '.agent-toggle']) {
    await expect(page.locator(`.overflow-menu ${sel}`)).toHaveCount(1)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
})

// The native pane is an OS-level overlay that covers renderer paint, so a
// menu reaching into the left half of the window would be invisible.
test('the open menu stays over the target pane', async () => {
  await page.click('.overflow-button')
  const [menu, pane] = await Promise.all([
    page.locator('.overflow-menu').boundingBox(),
    page.locator('.target-pane').boundingBox(),
  ])
  expect(menu!.x).toBeGreaterThanOrEqual(pane!.x)
  await page.keyboard.press('Escape')
})

test('icon buttons are at least 30px and the update button is not clipped', async () => {
  const back = await page.locator('.chrome-browse .icon-button').first().boundingBox()
  expect(back!.width).toBeGreaterThanOrEqual(30)
  expect(back!.height).toBeGreaterThanOrEqual(30)
})
```

- [ ] **Step 6: Run it**

```bash
npm run build && npx playwright test tests/e2e/toolbar.spec.ts
```

Expected: PASS, 4 tests. Task 8's CSS is what makes the 30px assertion pass — if that test alone fails here, leave it failing and pick it up in Task 8; every other assertion must pass now.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ tests/e2e/toolbar.spec.ts
git commit -m "feat(ui): split the toolbar into two rows with an overflow menu"
```

---

### Task 8: The craft pass

**Files:**
- Modify: `src/renderer/src/styles.css`, `src/main/ipc.ts`

- [ ] **Step 1: Raise `TOOLBAR_H`**

In `src/main/ipc.ts` line 27:

```ts
// 82px matches the two `.chrome-row` heights in styles.css (44 + 38, both
// border-box). Main lays the native view out with this until NativeSlot's
// first report takes ownership.
const TOOLBAR_H = 82
```

- [ ] **Step 2: Replace the toolbar CSS**

In `src/renderer/src/styles.css`, delete every rule from `.toolbar {` down to (and including) `.toolbar :is(button, select, input):focus-visible { … }`, and delete the two later blocks `.toolbar :is(.toggle-panel, .toggle-settings, .agent-toggle)[aria-pressed='true'] { … }` and `.toolbar .agent-toggle { … }` and `.toolbar .update-button { … }`. Insert in their place:

```css
/* Two strips. Browsing above; the controls that describe the simulated
   screen below, on a darker ground so the rows read as separate registers.
   44 + 38 = 82 must equal TOOLBAR_H in src/main/ipc.ts. */
.chrome { flex: 0 0 auto; }
.chrome-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
}
.chrome-browse { height: 44px; background: var(--chrome-1); }
.chrome-screen { height: 38px; background: var(--chrome-0); }
.chrome-spacer { flex: 1 1 auto; }

/* No blanket `button` rule here, ever. The old `.toolbar button { width:
   26px }` was specificity (0,1,1) and silently clipped the update button to
   "v0."; every control now sizes itself. */
.icon-button {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--chrome-2);
  color: var(--text-0);
  border: 1px solid var(--line);
  border-radius: 5px;
  cursor: pointer;
}

.url-form { flex: 1 1 auto; min-width: 160px; }
.url-form input {
  width: 100%;
  height: 30px;
  box-sizing: border-box;
  padding: 0 10px;
  font-size: 12.5px;
  background: var(--field);
  color: var(--text-0);
  border: 1px solid var(--line);
  border-radius: 5px;
}
.url-form input[readonly] { color: var(--text-1); }

.status-cluster { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; font-size: 10px; }
.badge-error {
  color: var(--error);
  border: 1px solid var(--error);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
/* An update is neither a warning nor an error, so it carries no colour. */
.update-button {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 10px;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  background: var(--chrome-2);
  color: var(--text-0);
  border: 1px solid var(--line);
  border-radius: 5px;
  cursor: pointer;
}

/* Our surface, the platform's popup: the real select sits transparent on
   top, keeping the native menu, keyboard handling and Playwright's
   `selectOption` working unchanged. */
.select-shell {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 30px;
  box-sizing: border-box;
  padding: 0 26px 0 9px;
  font-size: 11.5px;
  white-space: nowrap;
  background: var(--chrome-2);
  color: var(--text-0);
  border: 1px solid var(--line);
  border-radius: 5px;
}
.select-shell select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  appearance: none;
  cursor: pointer;
}
.select-shell .select-chevron {
  position: absolute;
  right: 7px;
  display: flex;
  color: var(--text-1);
  pointer-events: none;
}

/* Segmented groups. Pressed is a fill step and weight, never hue. */
.segmented {
  flex: 0 0 auto;
  display: inline-flex;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 5px;
  overflow: hidden;
}
.segmented button {
  height: 100%;
  padding: 0 11px;
  font-size: 11.5px;
  background: var(--chrome-2);
  color: var(--text-1);
  border: 0;
  border-right: 1px solid var(--line);
  border-radius: 0;
  cursor: pointer;
}
.segmented button:last-child { border-right: 0; }
.segmented button[aria-pressed='true'] { background: var(--chrome-3); color: var(--text-0); }

.overflow { position: relative; flex: 0 0 auto; }
.overflow-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  width: 200px;
  padding: 5px 0;
  font-size: 11.5px;
  background: var(--chrome-2);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 11px;
  text-align: left;
  background: none;
  color: var(--text-0);
  border: 0;
  border-radius: 0;
  cursor: pointer;
}
.menu-row:hover { background: var(--chrome-3); }
.menu-sep { height: 1px; margin: 5px 0; background: var(--line); }
.overflow-menu input[type='checkbox'] { accent-color: var(--text-0); }

/* Focus is a 1px inset neutral ring, never Chromium's accent outline. */
.chrome :is(button, select, input):focus { outline: none; }
.chrome :is(button, select, input):focus-visible {
  outline: 1px solid var(--text-1);
  outline-offset: -1px;
}
/* The real select is transparent, so its ring must land on the shell. */
.select-shell:has(select:focus-visible) { outline: 1px solid var(--text-1); outline-offset: -1px; }
```

- [ ] **Step 3: Add the fill step and retune the agent chip**

In `:root`, after `--chrome-2: #262626;`:

```css
  --chrome-3: #3a3a3a;
```

Replace the `.agent-activity` rule:

```css
/* Agent control opens a loopback server, so the chip persists while it is
   enabled; recent activity is a brighter text weight, not a colour. */
.agent-activity {
  flex: 0 0 auto;
  color: var(--text-1);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.agent-activity.active { color: var(--text-0); border-color: var(--text-0); }
```

- [ ] **Step 4: Update the stale comments**

The comment above the old `.toolbar` rule says "44px matches TOOLBAR_H"; it is replaced by the new block's comment. Check nothing else still refers to a 44px toolbar:

```bash
grep -rn "44px\|TOOLBAR_H\|\.toolbar" src/ docs/superpowers/specs/2026-08-23-obsrv-ui-style.md
```

Fix any surviving reference in `src/`. Leave the older spec documents alone — they record what was true when written.

- [ ] **Step 5: Run the toolbar spec**

```bash
npm run build && npx playwright test tests/e2e/toolbar.spec.ts
```

Expected: PASS, all 4 tests including the 30px assertion.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles.css src/main/ipc.ts
git commit -m "style(ui): 30px targets, a type scale, and no blanket button rule"
```

---

### Task 9: Repair the coupled specs

**Files:**
- Modify: `tests/e2e/launch.ts` and the eight specs listed below

Four controls moved into the overflow menu. Every spec that clicks one must open the menu first.

- [ ] **Step 1: See the damage**

```bash
npm run build && npx playwright test 2>&1 | tail -40
```

Record which specs fail. Expected offenders: `controls.spec.ts`, `image-mode.spec.ts`, `update.spec.ts`, `fit-pan.spec.ts`.

- [ ] **Step 2: Add the shared helper**

Append to `tests/e2e/launch.ts`:

```ts
/**
 * Opens the toolbar's overflow menu if it is not already open. Pixel-exact,
 * the two drawers and the agent toggle live there now, so a spec that clicks
 * one has to reach it first.
 */
export async function openOverflow(page: Page): Promise<void> {
  if (await page.locator('.overflow-menu').count()) return
  await page.click('.overflow-button')
  await page.waitForSelector('.overflow-menu')
}
```

- [ ] **Step 3: Fix `controls.spec.ts`**

Import the helper and rewrite `openDrawer`:

```ts
import { launchApp, openOverflow, rendererWindow } from './launch'
```

```ts
/** Opens the named drawer whatever is open now; each test owns its drawer state. */
const openDrawer = async (which: 'panel' | 'settings'): Promise<void> => {
  await openOverflow(page)
  const button = page.locator(`.overflow-menu .toggle-${which}`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') {
    await button.click()
  } else {
    await page.keyboard.press('Escape')
  }
  await expect(page.locator('.drawer')).toHaveCount(1)
}
```

The pressed check now reads the menu row, and a drawer that is already open needs the menu dismissed rather than toggled shut.

Then, for every `.pixel-exact` interaction in the file, insert `await openOverflow(page)` immediately before it.

- [ ] **Step 4: Fix the remaining specs**

For each of `image-mode.spec.ts`, `update.spec.ts`, `fit-pan.spec.ts`, `panes.spec.ts`, `mobile.spec.ts`, `live-drive.spec.ts`: import `openOverflow` and call it before any click on `.pixel-exact`, `.toggle-panel`, `.toggle-settings` or `.agent-toggle`.

Two selectors did **not** move and need no change: `.preset-select` and `.profile-select` are still real `<select>` elements (transparent over their shells, so still visible to Playwright), and `.close-image` is still in row 1.

`tests/unit/store.test.ts` and `tests/unit/calibration.test.ts` touch the store, not the DOM — they should already pass. If they fail, the cause is Task 1, not this task.

- [ ] **Step 5: Add the regression the old markup allowed**

Append to `tests/e2e/update.spec.ts`, inside the block where an update is available:

```ts
// The 0.7.0 bug: `.toolbar button { width: 26px }` clipped this to "v0." and
// a text assertion still passed. Measure it, don't read it.
const box = await page.locator('.update-button').boundingBox()
expect(box!.width).toBeGreaterThan(60)
```

- [ ] **Step 6: Run everything**

```bash
npm run typecheck && npx vitest run tests/unit && npm run test:browser && npm run build && npx playwright test
```

Expected: PASS throughout.

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "test: reach the controls that moved into the overflow menu"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-08-27-obsrv-toolbar-design.md`

- [ ] **Step 1: Document the toggle in the README**

In the "Use" section, after the paragraph describing the `1:1 / Fit` control, add:

```markdown
The toolbar's `Both / Target` control hides the native pane so the target
render takes the whole window — useful for a small mobile preset that would
otherwise sit in half a window, and for agent captures. The native pane stays
loaded while hidden, so the URL bar, back/forward and link clicks keep working.
```

In the MCP section, add `panes` to the `obsrv_drive` description alongside `viewMode`.

- [ ] **Step 2: Record the risk outcome**

In the spec's "Risk, and how it is settled" section, replace the last paragraph with what Task 4 actually found — either that hiding the view is sufficient, or that the fallback was needed and why.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-27-obsrv-toolbar-design.md
git commit -m "docs: describe the solo-target view and record the throttling outcome"
```

---

## Self-Review

**Spec coverage.** Two strips → Task 7. Row-1 status cluster → Task 7. Overflow menu contents → Task 7. Persistent agent chip → Tasks 7–8. Vertical cost and `TOOLBAR_H` → Task 8. `panes` store slice → Task 1. Renderer solo layout → Task 3. Main visibility derivation → Task 2. SyncBus stays enabled → Task 2, Step 5 comment plus Task 4's test. Throttling risk and fallback → Task 4. Agent surface → Task 5. Lucide as a devDependency → Task 6. Hit targets, blanket-rule deletion, styled selects, type scale, radius, surfaces → Tasks 7–8. Test impact across nine files → Task 9. Out-of-scope items are untouched throughout.

**Two places the plan tells the engineer to look rather than giving code**, both deliberate, both with a command to run: the test-hook shape in Task 2 Step 2 and the scroll fixture in Task 4 Step 1. Inventing either would risk a plan that reads well and does not run.

**Naming consistency.** `Panes` / `AgentPanes` / `panes` / `setPanes` / `setNativeVisible` / `applyNativeVisibility` / `panesApplyError` are used identically in every task. `.panes-both` and `.panes-target` are introduced in Task 3 and reused unchanged as `Segmented` option classNames in Task 7, so the Task 3 tests keep passing across the rewrite. `.view-1x` / `.view-fit` and `.preset-select` / `.profile-select` are likewise preserved.
