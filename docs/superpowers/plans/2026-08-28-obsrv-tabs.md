# Obsrv Multi-Tab Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Obsrv hold several independent URL+screen sessions open at once as tabs, each with its own native and target pane, preset, profile and page state, switching between them without reloading.

**Architecture:** A tab is one `WebContentsView` plus one offscreen `BrowserWindow` — two Chromium renderer processes. Phase one extracts the genuinely per-session state out of `registerIpc`'s closure onto a `TabSession` object while there is still exactly one session, so the existing suite proves the refactor. Only then does a second session become possible. The single `FrameBus` is re-pointed on activation rather than duplicated, and every process-global `ipcMain` channel keeps exactly one listener that resolves `e.sender` to its tab.

**Tech Stack:** Electron 43 (`WebContentsView`, offscreen `BrowserWindow`), React 19, zustand 5, TypeScript 5, Vitest 3, Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-08-28-obsrv-tabs.md`

---

## What is actually per-tab

The spec lists the state to extract, and it over-lists. Mapping `registerIpc` line by line gives a smaller and more precise division. **Getting this wrong in the opposite direction is worse than not refactoring**: six copies of `update` would each go stale, and six `history` arrays would fight over one file.

| Per-tab — moves to `TabSession` | Line | Window-global — stays in `registerIpc` | Line |
|---|---|---|---|
| `native`, `target`, `sync` | ctx | `panesShowNative` (the Both/Target toggle is a window view mode) | 167 |
| `modeIsLive` (image mode is per tab) | 166 | `rendererDrivesLayout` + the slot rect | 196 |
| `viewportPending` / `viewportArrived` | 361–362 | `targetBounds` / `canvasBounds` — one canvas | 325, 329 |
| `uiState.presetId/profileId/viewMode/mode` | 321 | `uiState.panes` | 321 |
| | | `pendingApplies`, `rendererReported`, `warnedPendingOverflow` | 336–338 |
| | | `scrollSeq` / `scrollWaiters` — unique seqs, one map is correct | 228–229 |
| | | `settings`, `lastHost`, `update`, `releaseUrl`, `history`, `control` | 66, 280, 452, 507, 557 |

**The slot rect is global and every tab's native view is set to it.** Only the active view is visible, so activation needs no fresh measurement — the incoming view is already positioned.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/main/tabSession.ts` | The `TabSession` class: owns one native pane, one target source, one sync bus, and that session's state. Construction and teardown of a session pair. |
| `src/main/tabs.ts` | The `TabManager`: the list, the active id, add/close/activate, the cap, and the single `ipcMain` listeners that route by `e.sender`. |
| `src/shared/tabList.ts` | Pure list logic — add, close, which neighbour gets focus, cap enforcement, title derivation. No Electron. Unit-tested directly. |
| `src/shared/tabsFile.ts` | `loadTabs` / `saveTabs` for `tabs.json`, in `settings.ts`'s validation shape. |
| `src/renderer/src/components/TabBar.tsx` | The tab strip: tabs, close buttons, new-tab button, the driven-tab marker. |

**Modified**

| File | Change |
|---|---|
| `src/main/context.ts` | `AppContext` becomes `{ win, tabs: TabManager, bus, toolbarH }`. |
| `src/main/index.ts` | `boot()` constructs a `TabManager` with one initial session instead of a loose pair. |
| `src/main/ipc.ts` | Reads the active session through the manager; per-tab state moves off the closure. |
| `src/main/frameBus.ts` | Gains `setSource(target)`. |
| `src/main/syncBus.ts` | Loses its own `ipcMain.on`; gains a method the router calls. |
| `src/main/menu.ts` | `Cmd+T` / `Cmd+W` / `Cmd+1`–`9` menu items. |
| `src/shared/types.ts`, `src/shared/presets.ts`, `src/shared/settings.ts` | `maxTabs` on `Settings`, default 12, clamped 2–32. |
| `src/shared/control.ts` | `tabId` and `tabIndex` on `ControlStatus` / `AgentUiState`. |
| `src/renderer/src/state/store.ts` | Per-session fields move into `tabs: Record<id, TabState>` behind `activeId`. |
| `src/renderer/src/components/SettingsPanel.tsx` | The `maxTabs` number input. |
| `src/renderer/src/styles.css` | Tab bar; `TOOLBAR_H` 82 → 114. |

---

## Phase One — the session extraction

**Phase one adds no new tests, and that is deliberate.** The whole suite must stay green with no assertion changed. A refactor that touched every stateful value in `registerIpc` and left 418 unit and 179 e2e tests passing is the evidence; a new test written alongside it would only prove the new code agrees with itself.

### Task 1: `TabSession` owns one pair

**Files:**
- Create: `src/main/tabSession.ts`
- Modify: `src/main/context.ts`, `src/main/index.ts`, `src/main/menu.ts`

- [ ] **Step 1: Write the session class**

Create `src/main/tabSession.ts`:

```ts
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { AgentViewMode } from '../shared/control'
import { NativePane } from './nativePane'
import { attachSyncBus, type SyncBus } from './syncBus'
import { TargetSource } from './targetSource'

let nextId = 1

/**
 * One tab: a native `WebContentsView`, an offscreen `TargetSource`, the
 * `SyncBus` mirroring between them, and the state that belongs to that pair
 * rather than to the window.
 *
 * State lives here rather than in `registerIpc`'s closure because closure
 * state plus several sessions fails without erroring — a value silently
 * serves whichever session wrote it last, and the symptom surfaces somewhere
 * unrelated. See the spec's sequencing section.
 */
export class TabSession {
  readonly id: string
  readonly native: NativePane
  readonly target: TargetSource
  readonly sync: SyncBus

  /** False in image mode: the left pane is drawn in the renderer instead. */
  modeIsLive = true
  /** A preset change is in flight; a capture or scroll must wait for it. */
  viewportPending = false
  viewportArrived = false

  presetId = '1080p-24'
  profileId = 'reference'
  viewMode: AgentViewMode = 'fit'

  constructor(win: BrowserWindow, onUrlChanged: (url: string) => void) {
    this.id = `tab-${nextId++}`
    this.native = new NativePane(win, {
      onLoadError: err => {
        if (!win.isDestroyed()) win.webContents.send(IPC.loadError, err)
      },
      onImageDrop: path => {
        if (!win.isDestroyed()) win.webContents.send(IPC.openImagePath, path)
      },
    })
    this.target = new TargetSource()
    this.sync = attachSyncBus(this.native, this.target, onUrlChanged)
  }

  destroy(): void {
    this.sync.detach()
    this.target.destroy()
    this.native.view.webContents.close()
  }
}
```

- [ ] **Step 2: Point `AppContext` at a session**

In `src/main/context.ts`, replace the `native`, `target`, `sync` fields with:

```ts
  /** The one session, until Task 4 introduces the manager. */
  session: TabSession
```

Keep `win`, `bus` and `toolbarH` exactly as they are. Import `TabSession` from `./tabSession` and drop the now-unused `NativePane` / `TargetSource` / `SyncBus` type imports.

- [ ] **Step 3: Build it in `boot()`**

In `src/main/index.ts`, replace the `new NativePane(...)`, `new TargetSource()` and `attachSyncBus(...)` construction with:

```ts
  const session = new TabSession(win, url => {
    if (!win.isDestroyed()) win.webContents.send(IPC.urlChanged, url)
  })
  const { native, target } = session

  native.webContents.on('focus', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.nativeFocused)
  })
  target.on('load-error', err => {
    if (!win.isDestroyed()) win.webContents.send(IPC.loadError, err)
  })
  target.on('loading', loading => {
    if (!win.isDestroyed()) win.webContents.send(IPC.targetLoading, loading)
  })
  target.on('navigating', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.targetNavigating)
  })

  const bus = attachFrameBus(target, win)
  const ctx: AppContext = { win, session, bus, toolbarH: TOOLBAR_H }
```

Note `NativePane`'s `onLoadError` now lives inside `TabSession`, so the old inline construction of it is gone; the `target.on('load-error')` forward stays in `boot()` because `TargetSource` takes its listeners after construction.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: errors in `src/main/ipc.ts`, `src/main/testHooks.ts` and `src/main/menu.ts`, which still destructure `native`/`target`/`sync` from the context. Task 2 fixes them. Do not commit yet.

`installMenu` takes the whole `AppContext` and destructures `{ win, native, target }` in its signature, so it breaks with the other two. Give it the same one-line re-point:

```ts
export function installMenu({ win, session }: AppContext): void {
  const { native, target } = session
```

---

### Task 2: `registerIpc` reads the session

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/testHooks.ts`, `src/main/menu.ts`

- [ ] **Step 1: Re-point the destructure**

In `src/main/ipc.ts` line 64, replace:

```ts
  const { win, native, target, bus, sync } = ctx
```

with:

```ts
  const { win, bus, session } = ctx
  const { native, target, sync } = session
```

This keeps every existing reference working unchanged. The destructure is temporary — Task 5 replaces it with an active-session lookup — but it lets this task be a pure state move with no behaviour change.

- [ ] **Step 2: Move `modeIsLive` onto the session**

Delete `let modeIsLive = true` (line 166). In `applyNativeVisibility` and the `IPC.setMode` handler, replace every `modeIsLive` with `session.modeIsLive`. Leave `panesShowNative` exactly where it is — the Both/Target toggle is a window view mode, not a tab's.

- [ ] **Step 3: Move the viewport settle pair**

Delete `let viewportPending = false` and `let viewportArrived = false` (lines 361–362). Replace every use with `session.viewportPending` / `session.viewportArrived`. There are uses in `awaitViewportStable`, in the `IPC.setViewport` handler, and in the agent apply path where `patch.presetId !== undefined` sets the flag — find them all with:

```bash
grep -n "viewportPending\|viewportArrived" src/main/ipc.ts
```

- [ ] **Step 4: Split the UI-state mirror**

`uiState` (line 321) mixes per-tab and window-global fields. Leave the object where it is — it is the wire shape the control server answers with — but make the three per-tab fields read and write through the session so they cannot diverge:

```ts
  // `panes` is a window view mode and stays here; the rest describe the tab
  // and live on the session, so a second tab cannot inherit the first's.
  const uiState: AgentUiState = {
    get presetId() { return session.presetId },
    set presetId(v: string) { session.presetId = v },
    get profileId() { return session.profileId },
    set profileId(v: string) { session.profileId = v },
    get viewMode() { return session.viewMode },
    set viewMode(v: AgentViewMode) { session.viewMode = v },
    get mode() { return session.modeIsLive ? 'url' : 'image' },
    set mode(v: 'url' | 'image') { session.modeIsLive = v === 'url' },
    panes: 'both',
  }
```

Check `AgentUiState`'s `mode` type is `'url' | 'image'` before writing this; if the `IPC.uiState` handler assigns fields individually rather than replacing the object, accessors are the right shape. If it replaces the whole object (`uiState = parsed`), convert those assignments to per-field writes instead — an object literal would drop the accessors silently.

- [ ] **Step 5: Fix the test hooks**

In `src/main/testHooks.ts`, the published `globalThis.__obsrv` is the context. E2E specs reach `__obsrv.native`, `__obsrv.target` and `__obsrv.toolbarH`. Keep those names working by spreading the session's members alongside the context:

```ts
  // Specs reach __obsrv.native / .target directly. Keep those names pointing
  // at the active session so the extraction changes no test.
  ;(globalThis as { __obsrv?: unknown }).__obsrv = {
    ...ctx,
    get native() { return ctx.session.native },
    get target() { return ctx.session.target },
    get sync() { return ctx.session.sync },
  }
```

Read the file first — match however it currently assigns, and preserve the `OBSRV_TEST` gate.

- [ ] **Step 6: Typecheck and run everything**

```bash
npm run typecheck && npx vitest run tests/unit && npm run build && npx playwright test
```

Expected: **418 unit and 179 e2e passing, with no test file modified.** If any assertion had to change, the extraction changed behaviour — stop and find out why rather than editing the test.

- [ ] **Step 7: Commit**

```bash
git add src/main/tabSession.ts src/main/context.ts src/main/index.ts src/main/ipc.ts src/main/menu.ts src/main/testHooks.ts
git commit -m "refactor(main): move per-session state onto TabSession"
```

---

## Phase Two — the machinery for more than one

### Task 3: The pure tab list

**Files:**
- Create: `src/shared/tabList.ts`
- Test: `tests/unit/tabList.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tabList.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { closeTab, tabTitle, canAddTab } from '../../src/shared/tabList'

const list = (...ids: string[]) => ids.map(id => ({ id }))

describe('closeTab', () => {
  it('activates the tab to the right when closing the active one', () => {
    const r = closeTab(list('a', 'b', 'c'), 'b', 'b')
    expect(r.tabs.map(t => t.id)).toEqual(['a', 'c'])
    expect(r.activeId).toBe('c')
  })

  it('activates the tab to the left when closing the last one', () => {
    const r = closeTab(list('a', 'b', 'c'), 'c', 'c')
    expect(r.activeId).toBe('b')
  })

  it('leaves the active tab alone when closing a different one', () => {
    const r = closeTab(list('a', 'b', 'c'), 'a', 'c')
    expect(r.activeId).toBe('c')
  })

  it('reports empty when the only tab closes, so the caller opens a blank one', () => {
    const r = closeTab(list('a'), 'a', 'a')
    expect(r.tabs).toEqual([])
    expect(r.activeId).toBeNull()
  })
})

describe('canAddTab', () => {
  it('allows up to the cap and refuses past it', () => {
    expect(canAddTab(11, 12)).toBe(true)
    expect(canAddTab(12, 12)).toBe(false)
  })
})

describe('tabTitle', () => {
  it('prefers the page title', () => {
    expect(tabTitle('https://usekolo.app/pricing', 'Kolo — Pricing')).toBe('Kolo — Pricing')
  })

  it('falls back to the host when there is no title', () => {
    expect(tabTitle('https://usekolo.app/pricing', '')).toBe('usekolo.app')
  })

  it('keeps the port, which is what distinguishes local servers', () => {
    expect(tabTitle('http://localhost:4173/', '')).toBe('localhost:4173')
  })

  it('falls back to the raw string when it is not a URL', () => {
    expect(tabTitle('not a url', '')).toBe('not a url')
  })

  it('names a blank tab', () => {
    expect(tabTitle('', '')).toBe('New tab')
  })
})
```

The port case is the one that matters most in this app: `localhost:4173` and `localhost:4331` are the whole difference between two tabs, and a host-only title would render them identically.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/tabList.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `src/shared/tabList.ts`:

```ts
/** The minimum a list operation needs; the manager's sessions carry more. */
export interface TabRef {
  id: string
}

export interface CloseResult<T extends TabRef> {
  tabs: T[]
  /** Null when the list is now empty — the caller opens a blank tab. */
  activeId: string | null
}

/**
 * Removes a tab and says which one should take focus. Closing the active tab
 * moves right, because the tab that took its screen position is the one the
 * eye is already on; at the end of the strip there is nothing to the right, so
 * it moves left.
 */
export function closeTab<T extends TabRef>(tabs: T[], closeId: string, activeId: string): CloseResult<T> {
  const index = tabs.findIndex(t => t.id === closeId)
  if (index === -1) return { tabs, activeId }
  const next = tabs.filter(t => t.id !== closeId)
  if (next.length === 0) return { tabs: next, activeId: null }
  if (closeId !== activeId) return { tabs: next, activeId }
  const neighbour = next[Math.min(index, next.length - 1)]!
  return { tabs: next, activeId: neighbour.id }
}

export function canAddTab(count: number, max: number): boolean {
  return count < max
}

/**
 * What the strip shows. The port is kept deliberately: two local dev servers
 * differ only by it, and a host-only label would render them identically.
 */
export function tabTitle(url: string, pageTitle: string): string {
  if (pageTitle.trim() !== '') return pageTitle
  if (url.trim() === '') return 'New tab'
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
npx vitest run tests/unit/tabList.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Verify the tests have teeth**

For each of these, break it, confirm the named test fails, restore, confirm it passes. Report before and after:

| Break | Test that must fail |
|---|---|
| `Math.min(index, …)` → `Math.max(0, index - 1)` | closing the active tab activates the right |
| `if (next.length === 0)` returns `activeId` instead of null | the only tab closing reports empty |
| `count < max` → `count <= max` | the cap refuses past it |
| drop the `new URL(url).host` branch | the host fallback, and the port case |

A green test whose failure mode you have not observed is not evidence — this project has shipped a vacuous test before.

- [ ] **Step 6: Commit**

```bash
git add src/shared/tabList.ts tests/unit/tabList.test.ts
git commit -m "feat(tabs): add the pure tab-list module"
```

---

### Task 4: `maxTabs` on Settings

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/presets.ts`, `src/shared/settings.ts`, `src/shared/ipcPayloads.ts`
- Test: `tests/unit/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/settings.test.ts`, matching the file's existing style for the other fields:

```ts
describe('maxTabs', () => {
  it('defaults when absent', () => {
    // write a settings file with no maxTabs key, load it
    expect(load({}).maxTabs).toBe(12)
  })

  it('clamps below the band', () => {
    expect(load({ maxTabs: 1 }).maxTabs).toBe(12)
  })

  it('clamps above the band', () => {
    expect(load({ maxTabs: 999 }).maxTabs).toBe(12)
  })

  it('keeps a value inside the band', () => {
    expect(load({ maxTabs: 4 }).maxTabs).toBe(4)
  })

  it('refuses to save one outside the band', () => {
    expect(() => save({ ...DEFAULT_SETTINGS, maxTabs: 99 })).toThrow(RangeError)
  })
})
```

Read the file first and use its existing helpers for writing a temp settings file and loading it — do not invent `load`/`save` shims if it already has them.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/settings.test.ts -t maxTabs
```

Expected: FAIL — `maxTabs` is undefined.

- [ ] **Step 3: Add the field**

In `src/shared/types.ts`, on `Settings`:

```ts
  /**
   * How many tabs may be open. Every tab is two Chromium renderer processes,
   * so the ceiling depends on the machine rather than on a number anyone can
   * pick for everyone — 12 is a judgement about process count, not a measurement.
   */
  maxTabs: number
```

In `src/shared/presets.ts`, beside the other bounds:

```ts
export const MAX_TABS_MIN = 2
export const MAX_TABS_MAX = 32
```

and `maxTabs: 12` in `DEFAULT_SETTINGS`.

In `src/shared/settings.ts`, beside `isRatio`:

```ts
const isTabCap = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MAX_TABS_MIN && v <= MAX_TABS_MAX
```

In `loadSettings`, with a comment in the file's voice explaining that an out-of-band cap falls back rather than failing the load; in `saveSettings`, a `RangeError` like its neighbours. Then add `maxTabs` to `parseSettings` in `src/shared/ipcPayloads.ts` — the renderer sends settings over IPC, and a field missing there is silently dropped on the wire even though every type checks out.

- [ ] **Step 4: Run everything**

```bash
npx vitest run tests/unit && npm run typecheck
```

Expected: PASS. Existing settings fixtures will need `maxTabs` added — update them; that is a shape change, not a weakened assertion.

- [ ] **Step 5: Verify teeth**

Remove the clamp in `loadSettings` and confirm the two clamp tests fail; remove the `saveSettings` guard and confirm the throw test fails; drop `maxTabs` from `parseSettings` and confirm a round-trip test fails. Restore each.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/presets.ts src/shared/settings.ts src/shared/ipcPayloads.ts tests/unit
git commit -m "feat(settings): add a configurable tab cap"
```

---

### Task 5: `tabs.json` persistence

**Files:**
- Create: `src/shared/tabsFile.ts`
- Test: `tests/unit/tabsFile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tabsFile.test.ts`, following `tests/unit/settings.test.ts`'s temp-file pattern:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadTabs, saveTabs } from '../../src/shared/tabsFile'

let dir: string
const file = (): string => {
  dir = mkdtempSync(join(tmpdir(), 'obsrv-tabs-'))
  return join(dir, 'tabs.json')
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('loadTabs', () => {
  it('round-trips a saved list', () => {
    const f = file()
    saveTabs(f, { tabs: [{ url: 'http://localhost:4173/', presetId: 'laptop-768', profileId: 'budget-tn' }], activeIndex: 0 })
    expect(loadTabs(f)).toEqual({
      tabs: [{ url: 'http://localhost:4173/', presetId: 'laptop-768', profileId: 'budget-tn' }],
      activeIndex: 0,
    })
  })

  it('reads an absent file as empty', () => {
    expect(loadTabs(join(mkdtempSync(join(tmpdir(), 'obsrv-tabs-')), 'nope.json'))).toEqual({ tabs: [], activeIndex: 0 })
  })

  it('reads a malformed file as empty rather than throwing', () => {
    const f = file()
    writeFileSync(f, '{ not json')
    expect(loadTabs(f)).toEqual({ tabs: [], activeIndex: 0 })
  })

  it('drops an entry whose url is not a string', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ tabs: [{ url: 5 }, { url: 'https://x/' }], activeIndex: 0 }))
    expect(loadTabs(f).tabs).toHaveLength(1)
  })

  it('clamps an activeIndex past the end', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ tabs: [{ url: 'https://x/' }], activeIndex: 9 }))
    expect(loadTabs(f).activeIndex).toBe(0)
  })

  it('falls back to defaults for an unknown preset or profile', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ tabs: [{ url: 'https://x/', presetId: 'nope', profileId: 'nope' }], activeIndex: 0 }))
    const t = loadTabs(f).tabs[0]!
    expect(t.presetId).toBe('1080p-24')
    expect(t.profileId).toBe('reference')
  })
})
```

The last one matters: a preset can be removed between releases, and a stored id that no longer exists must not leave a tab pointing at nothing.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/tabsFile.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `src/shared/tabsFile.ts`, mirroring `src/shared/settings.ts` exactly in structure — per-field validation with a fallback on load, throwing guards on save, a malformed file treated as empty:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, PANEL_PROFILES, SCREEN_PRESETS } from './presets'

export interface StoredTab {
  url: string
  presetId: string
  profileId: string
}

export interface StoredTabs {
  tabs: StoredTab[]
  activeIndex: number
}

const DEFAULT_PRESET = '1080p-24'
const DEFAULT_PROFILE = PANEL_PROFILES[0]!.id

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * Tabs live in their own file rather than in `settings.json`: they have a
 * different lifetime and a different failure mode, and a corrupt tab list
 * must not cost the user their monitor calibration.
 *
 * A stored preset or profile id that no longer exists falls back rather than
 * being kept — ids can be removed between releases, and a tab pointing at a
 * preset that is gone would render nothing with no way to say why.
 */
export function loadTabs(file: string): StoredTabs {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!isRecord(raw) || !Array.isArray(raw.tabs)) return { tabs: [], activeIndex: 0 }
    const tabs: StoredTab[] = []
    for (const entry of raw.tabs) {
      if (!isRecord(entry) || typeof entry.url !== 'string') continue
      tabs.push({
        url: entry.url,
        presetId: SCREEN_PRESETS.some(p => p.id === entry.presetId) ? (entry.presetId as string) : DEFAULT_PRESET,
        profileId: PANEL_PROFILES.some(p => p.id === entry.profileId) ? (entry.profileId as string) : DEFAULT_PROFILE,
      })
    }
    const idx = raw.activeIndex
    const activeIndex = typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < tabs.length ? idx : 0
    return { tabs, activeIndex }
  } catch {
    return { tabs: [], activeIndex: 0 }
  }
}

export function saveTabs(file: string, s: StoredTabs): void {
  if (!Array.isArray(s.tabs)) throw new TypeError('tabs must be an array')
  for (const t of s.tabs) {
    if (typeof t.url !== 'string') throw new TypeError('each tab needs a url string')
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}
```

`DEFAULT_SETTINGS` is imported only if you use it; drop the import if not.

- [ ] **Step 4: Run and watch it pass**

```bash
npx vitest run tests/unit/tabsFile.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify teeth**

Break each of: the `typeof entry.url !== 'string'` skip, the preset-existence check, the `activeIndex` bound, and the `catch`. Confirm the matching test fails each time, restore, confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/tabsFile.ts tests/unit/tabsFile.test.ts
git commit -m "feat(tabs): persist tab URLs in their own file"
```

---

### Task 6: `FrameBus.setSource` and painting control

**Files:**
- Modify: `src/main/frameBus.ts`, `src/main/tabSession.ts`
- Test: `tests/e2e/tabs.spec.ts` (create)

There is one canvas in the renderer, so there is one bus. Activation re-points it; it is never duplicated.

- [ ] **Step 1: Add `setSource`**

In `src/main/frameBus.ts`, `attachFrameBus(target, win)` currently closes over a single `target`. Make the source mutable:

```ts
export interface FrameBus {
  detach(): void
  setEnabled(enabled: boolean): void
  /**
   * Points the bus at a different target — tab activation. The previous
   * source is unsubscribed and the new one invalidated, so the canvas is
   * filled by a full frame immediately rather than waiting for the new page
   * to happen to repaint.
   */
  setSource(next: TargetSource): void
}
```

Implement by moving `target.on('frame', onFrame)` into a `bind(next)` helper that first calls `current.off('frame', onFrame)`, and have `setSource` call it then `next.invalidate()` when `ready && enabled`.

- [ ] **Step 2: Add painting control to the session**

In `src/main/tabSession.ts`:

```ts
  /**
   * Background tabs stay loaded but stop rasterising. Offscreen rendering runs
   * at 30fps with `backgroundThrottling: false`, so without this every hidden
   * tab would paint a full viewport forever for nobody. The page keeps its DOM,
   * timers, network and scroll — only pixel production stops.
   */
  setPainting(painting: boolean): void {
    if (this.painting === painting) return
    this.painting = painting
    const wc = this.target.webContents
    if (wc.isDestroyed()) return
    if (painting) wc.startPainting()
    else wc.stopPainting()
  }
```

with `painting = true` as a field.

- [ ] **Step 3: Write the e2e that proves painting stops**

Create `tests/e2e/tabs.spec.ts`:

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

test('a session stops and resumes painting', async () => {
  const painting = () =>
    app.evaluate(() => !(globalThis as any).__obsrv.session.target.webContents.isPainting())

  expect(await painting()).toBe(false)
  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(false))
  await expect.poll(painting).toBe(true)
  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(true))
  await expect.poll(painting).toBe(false)
})
```

`isPainting()` returns true when painting, so the helper's inversion above is deliberately confusing — rename it to `stopped` and assert accordingly rather than shipping that. Fix it while writing.

- [ ] **Step 4: Run it**

```bash
npm run build && npx playwright test tests/e2e/tabs.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Verify teeth**

Make `setPainting` a no-op, confirm the test fails, restore, confirm it passes.

- [ ] **Step 6: Full suite and commit**

```bash
npm run typecheck && npx playwright test
git add src/main/frameBus.ts src/main/tabSession.ts tests/e2e/tabs.spec.ts
git commit -m "feat(tabs): retarget the frame bus and suspend background painting"
```

---

### Task 7: The `TabManager` and the sender router

**Files:**
- Create: `src/main/tabs.ts`
- Modify: `src/main/context.ts`, `src/main/index.ts`, `src/main/syncBus.ts`, `src/main/ipc.ts`, `src/main/menu.ts`
- Test: `tests/e2e/tabs.spec.ts`

This is the task the spec calls out as most likely to produce silent cross-tab corruption.

- [ ] **Step 1: Move `SyncBus` off the global channel**

`attachSyncBus` registers `ipcMain.on(IPC.syncScroll, onScroll)`. With one bus per tab, every bus receives every scroll. Remove that registration and expose the handler instead:

```ts
export interface SyncBus {
  expect(url: string): void
  /** Called by the manager's single `syncScroll` listener, after it has
   *  resolved the sending webContents to this tab. */
  onScroll(e: IpcMainEvent, raw: unknown): void
  detach(): void
}
```

Move the body of the existing `onScroll` into the returned object and delete both the `ipcMain.on` and its `ipcMain.off` in `detach`.

- [ ] **Step 2: Write the manager**

Create `src/main/tabs.ts` with a `TabManager` exposing:

```ts
  readonly tabs: TabSession[]
  activeId: string
  active(): TabSession
  add(): TabSession | null          // null at the cap
  close(id: string): void
  activate(id: string): void
  byWebContents(wc: WebContents): TabSession | undefined
  destroy(): void
```

`activate` sets `painting` false on the outgoing session and true on the incoming, calls `bus.setSource(next.target)`, calls `setVisible` on both native views, and applies the stored slot rect to the incoming view so it is positioned before it is shown — the same ordering hazard the Both/Target toggle already documents.

The manager owns **one** `ipcMain.on(IPC.syncScroll, …)` that resolves `e.sender` through `byWebContents` and forwards to that tab's `sync.onScroll`. A message from a webContents that belongs to no tab is dropped, not guessed at.

`installMenu` also takes the context, and its Cmd+R reloads both panes of *a* session. It needs the active-session lookup like everything else: replace phase one's `const { native, target } = session` destructure with a `tabs.active()` call inside each menu item's `click`, so Cmd+R reloads the tab in front rather than whichever one booted first. A destructure at `installMenu` time captures the first session forever.

- [ ] **Step 3: Write the isolation test**

This is the test that matters most in the whole plan:

```ts
test('a scroll in one tab does not move another', async () => {
  // Two tabs, both on the tall fixture, both scrolled to 0.
  // Scroll tab A to 800. Assert tab A's native pane moved and tab B's did not.
})
```

Fill in using `tests/e2e/sync.spec.ts`'s fixture and its `executeJavaScript('window.scrollY')` readout — read that spec first and copy its mechanism rather than inventing one. Do not assert only that A moved; the defect this guards is B moving too.

- [ ] **Step 4: Verify teeth on the isolation test**

Make the router forward to `tabs[0]` instead of the resolved tab. Confirm the isolation test fails. Restore. This is the mutation that proves the router is doing the routing.

- [ ] **Step 5: Full suite and commit**

```bash
npm run typecheck && npx vitest run tests/unit && npm run build && npx playwright test
git add src/main/tabs.ts src/main/context.ts src/main/index.ts src/main/syncBus.ts src/main/ipc.ts tests/e2e/tabs.spec.ts
git commit -m "feat(tabs): add the tab manager and route ipc by sender"
```

---

## Phase Three — the renderer

### Task 8: Per-tab store state

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `tests/unit/store.test.ts`

- [ ] **Step 1: Restructure the store**

Move `url`, `lastUrl`, `presetId`, `custom`, `profileId`, `profileOverride`, `pixelExact`, `viewMode`, `mode`, `image`, `error`, `targetLoading`, `fitScale`, `agentPan` and `agentHighlight` into:

```ts
export interface TabState { /* the fields above */ }

  tabs: Record<string, TabState>
  activeId: string
  tabOrder: string[]
```

Keep `panes`, `surround`, `settings`, `host`, `update` and `toast` at the top level — they describe the window and the machine.

Every existing action becomes a write through `activeId`. Add a private helper so each action is one line rather than fifteen spread copies:

```ts
const patchActive = (set: SetState, patch: Partial<TabState>): void =>
  set(s => ({ tabs: { ...s.tabs, [s.activeId]: { ...s.tabs[s.activeId]!, ...patch } } }))
```

Every existing selector (`selectScreen`, `selectViewport`, `selectScale`, `selectUrlBarText`, …) reads `s.tabs[s.activeId]` instead of `s` directly. Component code is unchanged because the selectors keep their signatures.

- [ ] **Step 2: Keep the existing store tests green**

`tests/unit/store.test.ts` calls `useStore.getState().setPreset(...)` and reads `useStore.getState().presetId`. Those reads now need the active tab. Update the test file's reads — **the assertions themselves must not change**, only where they read from. If an assertion has to change, the restructure changed behaviour.

- [ ] **Step 3: Add tab actions and their tests**

`addTab()`, `closeTab(id)`, `activateTab(id)` on the store, using `closeTab` from `src/shared/tabList.ts` so the neighbour logic is not written twice. Test: adding a tab leaves the first tab's preset untouched; switching back restores it.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/unit && npm run typecheck
git add src/renderer/src/state/store.ts tests/unit/store.test.ts
git commit -m "feat(tabs): make the renderer store per-tab"
```

---

### Task 9: The tab bar

**Files:**
- Create: `src/renderer/src/components/TabBar.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/main/ipc.ts`
- Test: `tests/e2e/tabs.spec.ts`

- [ ] **Step 1: Build the component**

A third `.chrome-row` **above** `.chrome-browse`. Per tab: the title from `tabTitle`, a close button, `aria-selected`, and the active tab marked by the `--chrome-3` fill step plus weight — the idiom `.segmented` and `.menu-row` already use. No hue.

The new-tab button is `disabled` at the cap with a `title` explaining why and where to change it:

```tsx
<button
  className="tab-new"
  type="button"
  disabled={!canAddTab(tabOrder.length, settings.maxTabs)}
  title={
    canAddTab(tabOrder.length, settings.maxTabs)
      ? 'New tab'
      : `${settings.maxTabs} tabs is the limit — each one is two Chromium processes. Raise it in Settings.`
  }
  onClick={addTab}
>
  <Icon name="plus" />
</button>
```

`plus` is not in `Icon.tsx`; add `Plus` from `lucide-react` to its map.

- [ ] **Step 2: Raise `TOOLBAR_H`**

The chrome grows by the tab row. Set `.chrome-tabs { height: 32px }`, making 114 total, and update `TOOLBAR_H` in `src/main/ipc.ts` to match. The existing `toolbar.spec.ts` assertion reads `TOOLBAR_H` off the context rather than hard-coding it, so it will follow — confirm it does.

- [ ] **Step 3: Tests**

- The strip shows one tab at boot.
- New tab adds one and activates it; the first tab's preset is unchanged on return.
- Closing the active tab activates its right neighbour.
- Closing the last remaining tab leaves exactly one blank tab, not zero.
- At `maxTabs`, the new-tab button is `disabled` and its `title` mentions Settings.
- Lowering `maxTabs` in Settings below the current count does not close tabs, and raising it re-enables the button without a relaunch.

- [ ] **Step 4: Screenshot**

Take one with four tabs open and look at it. Four visual defects in this app's chrome have been invisible to the entire suite and obvious in a picture; the tab strip is exactly the kind of thing that passes `toHaveCount` while looking wrong.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/components/Icon.tsx src/renderer/src/App.tsx src/renderer/src/styles.css src/main/ipc.ts tests/e2e/tabs.spec.ts
git commit -m "feat(tabs): add the tab strip"
```

---

### Task 10: Keyboard shortcuts

**Files:**
- Modify: `src/main/menu.ts`, `src/shared/ipc.ts`, `src/preload/app.ts`, `src/shared/api.ts`, `src/renderer/src/App.tsx`
- Test: `tests/e2e/tabs.spec.ts`

- [ ] **Step 1: Add the menu items**

`Cmd+T`, `Cmd+W`, and `Cmd+1`–`Cmd+9`. They go in the application menu, not a renderer `keydown` listener, for the same reason `Cmd+L` does: the native pane is an OS-level view outside the renderer's document, and a renderer listener is dead while it holds focus. Read how `IPC.focusUrl` is wired in `menu.ts` and follow it exactly.

`Cmd+9` selects the **last** tab, not the ninth — the browser convention.

- [ ] **Step 2: Test with focus in the native pane**

The test must focus the native pane first, then send the shortcut. A test that sends it with the renderer focused would pass against a renderer-only listener and prove nothing — that is the whole point of routing through the menu.

- [ ] **Step 3: Verify teeth**

Move a shortcut to a renderer `keydown` handler, confirm the native-pane-focused test fails, restore.

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts src/shared/ipc.ts src/preload/app.ts src/shared/api.ts src/renderer/src/App.tsx tests/e2e/tabs.spec.ts
git commit -m "feat(tabs): Cmd+T, Cmd+W and Cmd+1-9"
```

---

### Task 11: Restore tabs on relaunch

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/tabs.ts`
- Test: `tests/e2e/tabs.spec.ts`

- [ ] **Step 1: Save on change, restore at boot**

Write `tabs.json` when a tab is added, closed, activated, or navigates — not on every render. Restore in `boot()`: an empty or missing file opens one blank tab, which is today's behaviour exactly.

- [ ] **Step 2: Test restoration**

`launchApp` mkdtemps a fresh user-data dir per launch, so this needs a shared dir across two launches. Check whether `launchApp` accepts one; if not, extend it rather than contorting the test. Assert the URLs come back and that **scroll does not** — the spec is explicit that restoring a scroll into a page that may have changed is a guess presented as a memory.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts src/main/tabs.ts tests/e2e/launch.ts tests/e2e/tabs.spec.ts
git commit -m "feat(tabs): restore tab urls on relaunch"
```

---

## Phase Four — agents

### Task 12: `tabId` in status, and the driven-tab marker

**Files:**
- Modify: `src/shared/control.ts`, `src/main/controlServer.ts`, `src/main/ipc.ts`, `src/mcp/server.ts`, `src/renderer/src/components/TabBar.tsx`
- Test: `tests/unit/control.test.ts`, `tests/e2e/live-drive.spec.ts`

- [ ] **Step 1: Add the fields**

`tabId: string` and `tabIndex: number` on `AgentUiState` and `ControlStatus`, and on the MCP `status` output shape and drive passthrough. `parseControlStatus` must **default** them when absent — the MCP server ships on npm and the app ships as a DMG, so a newer server routinely talks to an older app. This project has already been bitten by exactly that skew.

- [ ] **Step 2: Mark the driven tab**

While `settings.agentControl` is on, the active tab carries a persistent neutral marker — the 2px inset rule `.menu-row[aria-pressed='true']` and `.surround-control` already use — and brightens for ~3s on each command, driven by the existing `IPC.agentActivity` the `AGENT` chip already listens to.

No hue and no glow. A blur would be the first shadow in the app, and the rule against it is what stops the chrome biasing the render beside it.

- [ ] **Step 3: Tests**

- `status` reports the active tab's id, and it changes when the user switches tabs.
- A status without `tabId` (an older app) parses with a default rather than returning null.
- The marker appears only while agent control is on, and only on the active tab.

- [ ] **Step 4: Commit**

```bash
git add src/shared/control.ts src/main/controlServer.ts src/main/ipc.ts src/mcp/server.ts src/renderer/src/components/TabBar.tsx tests/
git commit -m "feat(agent): report the active tab, and mark it while driving"
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-08-28-obsrv-tabs.md`

- [ ] **Step 1: README**

Describe tabs in the Use section — independent preset and profile per tab, background tabs loaded but not painting, the configurable cap. In the MCP section, note that `obsrv_drive` and `obsrv_snap` act on the active tab and that `status` reports which.

- [ ] **Step 2: Record what the build found**

Update the spec's own claims where the implementation contradicted them — the per-tab/global division in particular, which the plan corrected before a line was written.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-28-obsrv-tabs.md
git commit -m "docs: describe multi-tab sessions"
```

---

## Self-Review

**Spec coverage.** Tab bar → Task 9. New tab / close / titles → Tasks 3, 9. Per-tab `BrowserView` pair, background tabs not destroyed → Tasks 1, 6, 7. Persistence → Tasks 5, 11. Keyboard → Task 10. MCP/headless untouched → nothing in `src/cli/` is modified by any task, which is the assertion. Agent targets the active tab and reports it → Task 12. Neutral style → Tasks 9, 12. Per-tab scroll sync → Task 7, and its isolation test is the sharpest one here. `maxTabs` configurable with a dimmed button → Tasks 4, 9. Session extraction first → Tasks 1, 2, ahead of every other task.

**Two places the plan says "go and read" rather than giving code**, both deliberate and both with the command: the scroll fixture in Task 7 and `launchApp`'s user-data handling in Task 11. Inventing either would produce a plan that reads well and does not run.

**One deliberate trap left in Task 6 Step 3**, flagged inline: the `painting` helper as written inverts `isPainting()` confusingly, and the step says to fix it while writing rather than shipping it. It is there because the sense of that API is genuinely easy to get backwards.

**Naming consistency.** `TabSession`, `TabManager`, `TabState`, `StoredTab`, `tabList.ts`, `tabsFile.ts`, `maxTabs`, `MAX_TABS_MIN`/`MAX_TABS_MAX`, `setPainting`, `setSource`, `byWebContents`, `canAddTab`, `tabTitle`, `closeTab` are used identically across every task. `closeTab` is both the pure function (Task 3) and the store action (Task 8) that calls it — deliberate, and noted here so it does not read as a collision.
