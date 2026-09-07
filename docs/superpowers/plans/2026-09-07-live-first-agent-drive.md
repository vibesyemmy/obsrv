# Live-first agent drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every MCP tool with a `mode` drives the visible Obsrv app by default, launching it when it is not running; the app asks the user when it is open with control off; agents get tabs and a page-wise scroll; the skill teaches a live review loop.

**Architecture:** The discovery file `control.json` becomes the single record of the app's stance (`enabled: true|false`). A pure decision (`planLive`) names the reason a call goes headless; a small impure orchestrator (`ensureLive`) discovers, launches and waits. Tabs are exposed over the existing `TabManager`; the consent bar is the only new UI. The headless renderer is untouched.

**Tech Stack:** TypeScript, Electron (main + preload + React renderer), MCP SDK (zod schemas), Vitest (unit), Playwright (e2e driving the real Electron app).

**Spec:** `docs/superpowers/specs/2026-09-07-live-first-agent-drive-design.md`

## Global Constraints

- `LAUNCH_TIMEOUT_MS = 12_000` — the bound on waiting for a launched app.
- Headless reasons, exactly these strings: `requested`, `headless-only`, `no-display`, `declined`, `launch-timeout`.
- No-display conditions: `OBSRV_HEADLESS=1`; `SSH_CONNECTION` set; Linux with neither `DISPLAY` nor `WAYLAND_DISPLAY`; `OBSRV_TEST=1`. **Under `OBSRV_TEST=1` the MCP never launches.**
- `report` and `diff` stay headless-only. `fullPage` and custom `width`/`height` are headless-only.
- `obsrv_drive` order: `tab → focus → url → preset → orientation → textScale → onionSkin → throttle → profile → viewMode → panes → vision → pixelExact → reload → back → forward → scroll → panTo → click → highlight → capture → closeTab`.
- `scroll.page` values: `next`, `prev`, `top`, `bottom`. Reply carries `atEnd: boolean`.
- Consent bar copy, verbatim: **An agent wants to drive Obsrv.** with buttons **Allow for this session** and **Not now**.
- Tab commands: `tabs`, `openTab`, `activateTab`, `closeTab`. `closeTab` refuses the last tab. `maxTabs` is the existing setting (default 12).
- No Windows launch path. No driving of background tabs.
- Never `git add -A` in this repo (`CLAUDE.md` and `.claude/launch.json` are untracked on purpose). Stage files by name.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Typecheck gate is `npm run typecheck` (three tsconfigs). Unit: `npm test`. Browser: `npm run test:browser`. E2E needs `npm run build` first, then `npx playwright test <spec>`.

## File map

| file | responsibility after this plan |
|---|---|
| `src/shared/control.ts` | discovery-file shape incl. `enabled`; tab command names + payload validation; `ControlStatus.tabs` |
| `src/shared/ipcPayloads.ts` | `parseScrollRequest` accepts `page`; `parseScrollReport` reads `atEnd` |
| `src/shared/types.ts` | `ScrollRequest.page`, `ScrollReport.atEnd`, `ScrollPage` |
| `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/app.ts` | consent request/answer channels |
| `src/preload/sync.ts` | page-wise scroll |
| `src/main/controlServer.ts` | writes the stance on start/stop; `shutdown()`; tab commands; `atEnd` |
| `src/main/ipc.ts` | tab deps over `TabManager`; consent handling; `hooks.secondInstance` |
| `src/main/index.ts` | `second-instance` → `hooks.secondInstance()` |
| `src/renderer/src/components/ConsentBar.tsx` (new) | the consent bar |
| `src/renderer/src/components/Toolbar.tsx` | AGENT chip becomes a Stop button |
| `src/mcp/lib.ts` | `planLive`, `noDisplayReason`, `HeadlessWhy`; `planSnapPath` over `planLive` |
| `src/mcp/launch.ts` (new) | resolve + spawn + wait |
| `src/mcp/control.ts` | `discover()` (three kinds), `ensureLive()` |
| `src/mcp/server.ts` | tools use `ensureLive`; `why`/`launched`; drive `tab`/`closeTab`/`tabs`/`atEnd` |
| `skills/obsrv-screens/SKILL.md`, `README.md` | the live review loop; tabs no longer a limitation |

---

### Task 1: The discovery file records a stance

**Files:**
- Modify: `src/shared/control.ts` (around `ControlInfo` at line 41 and `parseControlFile` at line 233)
- Test: `tests/unit/control.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ControlStance { enabled: false; pid: number; startedAt?: string }
  export type ControlFile = ControlInfo | ControlStance
  export function parseControlFile(raw: string): ControlFile | null
  export function isDisabledStance(f: ControlFile): f is ControlStance   // 'port' not in f
  ```
  `ControlInfo` is unchanged (`port`, `token`, `pid?`, `startedAt?`); a file with `enabled: true` or no `enabled` at all parses to it, so every existing caller keeps working.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/control.test.ts` inside `describe('parseControlFile', …)`:

```ts
  it('reads a disabled stance: the app is running, control is off, there is nothing to call', () => {
    const raw = JSON.stringify({ enabled: false, pid: 4242, startedAt: '2026-09-07T09:00:00.000Z' })
    expect(parseControlFile(raw)).toEqual({ enabled: false, pid: 4242, startedAt: '2026-09-07T09:00:00.000Z' })
  })
  it('a disabled stance must name its process; without a pid nobody can tell it from a leftover', () => {
    expect(parseControlFile(JSON.stringify({ enabled: false }))).toBeNull()
    expect(parseControlFile(JSON.stringify({ enabled: false, pid: 0 }))).toBeNull()
  })
  it('enabled: true is the same as no enabled at all — an older app writes none', () => {
    expect(parseControlFile(JSON.stringify({ port: 49152, token: TOKEN, enabled: true }))).toEqual({ port: 49152, token: TOKEN })
  })
  it('enabled must be a boolean when present', () => {
    expect(parseControlFile(JSON.stringify({ port: 49152, token: TOKEN, enabled: 'yes' }))).toBeNull()
  })
  it('isDisabledStance tells the two apart', () => {
    expect(isDisabledStance({ enabled: false, pid: 1 })).toBe(true)
    expect(isDisabledStance({ port: 49152, token: TOKEN })).toBe(false)
  })
```

Add `isDisabledStance` to the import list at the top of the file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/control.test.ts`
Expected: FAIL — `isDisabledStance` is not exported; the disabled-stance case returns null.

- [ ] **Step 3: Implement**

In `src/shared/control.ts`, after `ControlInfo`:

```ts
/**
 * The app is running with agent control off. Written so a client can tell
 * "running, and the user said no" from "not running" — the first is asked
 * in the app (§2c of the live-first spec), the second is launched. No port
 * and no token: there is nothing to call.
 */
export interface ControlStance {
  enabled: false
  pid: number
  startedAt?: string
}

/** What the discovery file holds: a live server, or a running app's stance. */
export type ControlFile = ControlInfo | ControlStance

export function isDisabledStance(f: ControlFile): f is ControlStance {
  return !('port' in f)
}
```

Replace `parseControlFile`:

```ts
export function parseControlFile(raw: string): ControlFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { enabled, pid, startedAt } = parsed
  if (enabled !== undefined && typeof enabled !== 'boolean') return null
  // The owner stamp is optional on a live file (an older app writes none) but,
  // when present, must be well-formed: a stamp that cannot be trusted is worse
  // than no stamp, since a reader would act on it.
  if (pid !== undefined && (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1)) return null
  if (startedAt !== undefined && (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt)))) return null
  if (enabled === false) {
    // A stance without an owner is indistinguishable from a crashed run's
    // leftover, and a reader that trusted it would never launch the app.
    if (pid === undefined) return null
    return { enabled: false, pid, ...(startedAt !== undefined ? { startedAt } : {}) }
  }
  const { port, token } = parsed
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  return { port, token, ...(pid !== undefined ? { pid } : {}), ...(startedAt !== undefined ? { startedAt } : {}) }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --project unit tests/unit/control.test.ts && npm run typecheck`
Expected: PASS. Typecheck may fail in `src/mcp/control.ts` (`discoverControl` assumes `info.port`) — fix it minimally there for now: after `const info = parseControlFile(raw)`, add `if (!info || isDisabledStance(info)) return null` (import `isDisabledStance`). Task 5 replaces this properly.

- [ ] **Step 5: Commit**

```bash
git add src/shared/control.ts src/mcp/control.ts tests/unit/control.test.ts
git commit -m "feat(control): the discovery file can record a running app's stance

enabled: false with a pid means the app is up and agent control is off —
something a client should ask about, not launch over. No port, no token.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The app always writes its stance, and the chip is a Stop button

**Files:**
- Modify: `src/main/controlServer.ts` (`start`/`stop` at lines 170–205)
- Modify: `src/main/ipc.ts` (around `applyAgentControl`, line ~1575)
- Modify: `src/renderer/src/components/Toolbar.tsx` (the chip at line ~479)
- Modify: `src/renderer/src/styles.css` (`.agent-activity` at line 694)
- Test: `tests/e2e/live-drive.spec.ts`

**Interfaces:**
- Produces on `ControlServer`:
  ```ts
  writeDisabled(): void      // writes { enabled: false, pid, startedAt }, mode 0600
  stop(): void               // now: stops the server and writes the disabled stance (file stays)
  shutdown(): void           // stops the server and removes the file — quit only
  ```

- [ ] **Step 1: Write the failing e2e test**

In `tests/e2e/live-drive.spec.ts`, find the test that toggles agent control off through settings (search for `agent-toggle` and `existsSync(controlFile)).toBe(false)`). Replace its file assertion with the stance, and add a Stop-chip test. If no such test exists, add both after `'status answers with the app state…'`:

```ts
test('turning agent control off leaves a disabled stance, not an absent file', async () => {
  await openSettings(page, 'agent')
  await page.locator('.settings-modal .agent-toggle input').click()
  await closeSettings(page)
  await expect.poll(() => {
    const f = parseControlFile(readFileSync(controlFile, 'utf8'))
    return f && isDisabledStance(f) ? f.pid : null
  }).toBe(await app.evaluate(() => process.pid))
  expect(statSync(controlFile).mode & 0o777).toBe(0o600)
  // The server is gone: the old port refuses.
  await expect(call('status')).rejects.toThrow()
  // Back on for the tests that follow.
  await openSettings(page, 'agent')
  await page.locator('.settings-modal .agent-toggle input').click()
  await closeSettings(page)
  await expect.poll(() => {
    const f = parseControlFile(readFileSync(controlFile, 'utf8'))
    return f && !isDisabledStance(f)
  }).toBe(true)
  info = parseControlFile(readFileSync(controlFile, 'utf8')) as ControlInfo
})

test('the AGENT chip is a Stop button: one click turns control off', async () => {
  await expect(page.locator('button.agent-activity')).toBeVisible()
  await page.locator('button.agent-activity').click()
  await expect.poll(() => {
    const f = parseControlFile(readFileSync(controlFile, 'utf8'))
    return f !== null && isDisabledStance(f)
  }).toBe(true)
  await expect(page.locator('button.agent-activity')).toHaveCount(0)
  await openSettings(page, 'agent')
  await page.locator('.settings-modal .agent-toggle input').click()
  await closeSettings(page)
  await expect.poll(() => {
    const f = parseControlFile(readFileSync(controlFile, 'utf8'))
    return f && !isDisabledStance(f)
  }).toBe(true)
  info = parseControlFile(readFileSync(controlFile, 'utf8')) as ControlInfo
})
```

Add `isDisabledStance` to the import from `'../../src/shared/control'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/live-drive.spec.ts -g "disabled stance|Stop button"`
Expected: FAIL — the file is removed on stop; there is no `button.agent-activity`.

- [ ] **Step 3: Implement the stance in `ControlServer`**

In `src/main/controlServer.ts`, replace `stop()` and add two methods:

```ts
  /** The running app's stance while control is off: discoverable, not callable. */
  writeDisabled(): void {
    rmSync(this.file, { force: true })
    writeFileSync(this.file, JSON.stringify({ enabled: false, pid: process.pid, startedAt: STARTED_AT }), { mode: 0o600 })
  }

  /**
   * Stops the server. The file is not removed but rewritten as a disabled
   * stance: a client that finds it knows the app is up and the user turned
   * control off, and asks in the app rather than launching a second one.
   * Synchronous on purpose, like `shutdown`.
   */
  stop(): void {
    const server = this.server
    this.server = null
    this.token = ''
    if (server) {
      server.closeAllConnections()
      server.close()
    }
    this.writeDisabled()
  }

  /** Quit: the file must not outlive the process. */
  shutdown(): void {
    const server = this.server
    this.server = null
    this.token = ''
    rmSync(this.file, { force: true })
    if (server) {
      server.closeAllConnections()
      server.close()
    }
  }
```

In `src/main/ipc.ts`, at the block starting `if (process.env.OBSRV_AGENT_CONTROL === '1')`:

```ts
  if (process.env.OBSRV_AGENT_CONTROL === '1') settings = { ...settings, agentControl: true }
  if (settings.agentControl) applyAgentControl(true)
  else control.writeDisabled()
  // The discovery file must not outlive the process; `shutdown` removes it
  // synchronously before quit proceeds.
  app.on('will-quit', () => control.shutdown())
```

- [ ] **Step 4: The chip becomes a button**

In `src/renderer/src/components/Toolbar.tsx`, the chip line becomes:

```tsx
          {agentControl && (
            <button
              type="button"
              className={`agent-activity${agentActive ? ' active' : ''}`}
              title="An agent can drive this window. Click to stop."
              aria-label="Stop agent control"
              onClick={stopAgentControl}
            >
              AGENT
            </button>
          )}
```

Add, near the other handlers in the same component (it already reads `settings.agentControl` at line 138; `useStore` is imported):

```tsx
  const stopAgentControl = (): void => {
    const current = useStore.getState().settings
    const next = { ...current, agentControl: false }
    useStore.getState().setSettings(next)
    void window.obsrv.setSettings(next)
  }
```

In `styles.css`, make the rule apply to the button without changing its look:

```css
.agent-activity {
  flex: 0 0 auto;
  color: var(--warn);
  border: 1px solid var(--warn);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.agent-activity.active { color: var(--chrome-0); background: var(--warn); border-color: var(--warn); }
.agent-activity:hover { text-decoration: line-through; }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/live-drive.spec.ts`
Expected: PASS, whole file (other tests read `controlFile` as a live file — they still do while control is on).

- [ ] **Step 6: Commit**

```bash
git add src/main/controlServer.ts src/main/ipc.ts src/renderer/src/components/Toolbar.tsx src/renderer/src/styles.css tests/e2e/live-drive.spec.ts
git commit -m "feat(app): the discovery file always says where the app stands, and AGENT is a Stop button

Control off no longer removes control.json: it rewrites it as a disabled
stance naming this process, so a client can tell running-and-declined from
not-running. Only quit removes the file.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The headless decision is a pure table

**Files:**
- Modify: `src/mcp/lib.ts` (`planSnapPath` at line ~355; `SnapMode`, `SnapPathPlan` at 342)
- Test: `tests/unit/mcpLib.test.ts` (`describe('planSnapPath'` at line 174)

**Interfaces:**
- Produces:
  ```ts
  export type HeadlessWhy = 'requested' | 'headless-only' | 'no-display' | 'declined' | 'launch-timeout'
  export interface LivePlan { path: 'live'; notes: string[] }
  export interface HeadlessPlan { path: 'headless'; why: HeadlessWhy; notes: string[] }
  export function noDisplayReason(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null
  export function planLive(mode: SnapMode, headlessOnly: string[], liveNotes: string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform): LivePlan | HeadlessPlan
  export function planSnapPath(input, mode, env, platform): LivePlan | HeadlessPlan   // no liveReachable any more
  export const DECLINED_NOTE: string
  export const LAUNCH_TIMEOUT_MS = 12_000
  ```

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('planSnapPath'…)` block in `tests/unit/mcpLib.test.ts` with:

```ts
const DESKTOP = { HOME: '/Users/x' } as NodeJS.ProcessEnv

describe('noDisplayReason', () => {
  it('names the condition, or null when a window could appear', () => {
    expect(noDisplayReason(DESKTOP, 'darwin')).toBeNull()
    expect(noDisplayReason({ ...DESKTOP, OBSRV_HEADLESS: '1' }, 'darwin')).toMatch(/OBSRV_HEADLESS/)
    expect(noDisplayReason({ ...DESKTOP, SSH_CONNECTION: '1.2.3.4 22' }, 'darwin')).toMatch(/SSH/)
    expect(noDisplayReason({ ...DESKTOP, OBSRV_TEST: '1' }, 'darwin')).toMatch(/OBSRV_TEST/)
    expect(noDisplayReason({ ...DESKTOP }, 'linux')).toMatch(/DISPLAY/)
    expect(noDisplayReason({ ...DESKTOP, DISPLAY: ':0' }, 'linux')).toBeNull()
    expect(noDisplayReason({ ...DESKTOP, WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBeNull()
  })
})

describe('planLive', () => {
  it('the caller asked: headless, requested', () => {
    expect(planLive('headless', [], [], DESKTOP, 'darwin')).toEqual({ path: 'headless', why: 'requested', notes: [] })
  })
  it('a headless-only operation wins over everything but a request', () => {
    expect(planLive('auto', ['fullPage is headless-only'], ['x'], DESKTOP, 'darwin')).toEqual({
      path: 'headless',
      why: 'headless-only',
      notes: ['fullPage is headless-only'],
    })
    // Even under mode: live — the operation cannot be done live at all.
    expect(planLive('live', ['fullPage is headless-only'], [], DESKTOP, 'darwin')).toMatchObject({ path: 'headless', why: 'headless-only' })
  })
  it('no display: headless, naming the condition in the notes', () => {
    const p = planLive('auto', [], [], { ...DESKTOP, OBSRV_TEST: '1' }, 'darwin')
    expect(p).toMatchObject({ path: 'headless', why: 'no-display' })
    expect(p.notes.join(' ')).toMatch(/OBSRV_TEST/)
  })
  it('otherwise live, carrying the live-only notes', () => {
    expect(planLive('auto', [], ['waitMs is ignored in live mode'], DESKTOP, 'darwin')).toEqual({ path: 'live', notes: ['waitMs is ignored in live mode'] })
  })
})

describe('planSnapPath', () => {
  it('custom dims and fullPage are headless-only, with the reason named', () => {
    expect(planSnapPath({ fullPage: true }, 'auto', DESKTOP, 'darwin')).toMatchObject({ path: 'headless', why: 'headless-only' })
    expect(planSnapPath({ width: 800, height: 600 }, 'auto', DESKTOP, 'darwin')).toMatchObject({ path: 'headless', why: 'headless-only' })
  })
  it('a plain preset snap is live, and waitMs is noted as ignored', () => {
    expect(planSnapPath({ waitMs: 500 }, 'auto', DESKTOP, 'darwin')).toEqual({ path: 'live', notes: ['waitMs is headless-only and was ignored in live mode.'] })
  })
  it('capture: pane on a headless path is noted', () => {
    const p = planSnapPath({ capture: 'pane' }, 'headless', DESKTOP, 'darwin')
    expect(p).toMatchObject({ path: 'headless', why: 'requested' })
    expect(p.notes).toContain(PANE_CAPTURE_HEADLESS_NOTE)
  })
})
```

Add `noDisplayReason`, `planLive`, `PANE_CAPTURE_HEADLESS_NOTE` to the import; remove `APP_NOT_REACHABLE` only if nothing else in the file uses it.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/mcpLib.test.ts`
Expected: FAIL — `noDisplayReason`/`planLive` not exported; `planSnapPath` has the old signature.

- [ ] **Step 3: Implement**

In `src/mcp/lib.ts`, replace the `SnapMode`/`SnapPathPlan`/`planSnapPath` block with:

```ts
export type SnapMode = 'auto' | 'headless' | 'live'

/** Why a call went headless. Named in every result so an agent can say so. */
export type HeadlessWhy = 'requested' | 'headless-only' | 'no-display' | 'declined' | 'launch-timeout'

export interface LivePlan {
  path: 'live'
  /** Inputs that are ignored on the live path, one note each. */
  notes: string[]
}
export interface HeadlessPlan {
  path: 'headless'
  why: HeadlessWhy
  notes: string[]
}

/** How long a launched app gets to come up before the call goes headless. */
export const LAUNCH_TIMEOUT_MS = 12_000

export const DECLINED_NOTE =
  'the user turned agent control off in Obsrv, so this ran headlessly; ask them to enable it (the AGENT chip or Settings → Agent control) if you need the live app.'

/**
 * Whether a window could appear at all. A launch attempt where it could not
 * would hang on a lock or a missing display and burn the whole timeout to
 * learn nothing. `OBSRV_TEST=1` is here on purpose: under the e2e harness the
 * MCP must never launch a real Obsrv against the developer's profile.
 */
export function noDisplayReason(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (env.OBSRV_HEADLESS === '1') return 'OBSRV_HEADLESS=1 is set'
  if (env.OBSRV_TEST === '1') return 'OBSRV_TEST=1 is set (the e2e harness)'
  if (env.SSH_CONNECTION !== undefined && env.SSH_CONNECTION !== '') return 'this is an SSH session'
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return 'neither DISPLAY nor WAYLAND_DISPLAY is set'
  return null
}

/**
 * The four reasons not to try the live path, in order (spec §1). Pure: the
 * runtime reasons — declined, launch-timeout — come from `ensureLive`.
 */
export function planLive(
  mode: SnapMode,
  headlessOnly: string[],
  liveNotes: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): LivePlan | HeadlessPlan {
  if (mode === 'headless') return { path: 'headless', why: 'requested', notes: [] }
  if (headlessOnly.length > 0) return { path: 'headless', why: 'headless-only', notes: headlessOnly }
  const noDisplay = noDisplayReason(env, platform)
  if (noDisplay !== null) return { path: 'headless', why: 'no-display', notes: [`no display: ${noDisplay}; rendered headlessly.`] }
  return { path: 'live', notes: liveNotes }
}

export function planSnapPath(
  input: Pick<SnapToolInput, 'width' | 'height' | 'deviceScaleFactor' | 'diagonalInches' | 'fullPage' | 'waitMs' | 'capture'>,
  mode: SnapMode,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): LivePlan | HeadlessPlan {
  const headlessOnly: string[] = []
  const custom =
    input.width !== undefined ||
    input.height !== undefined ||
    input.deviceScaleFactor !== undefined ||
    input.diagonalInches !== undefined
  if (custom) headlessOnly.push('custom dimensions are headless-only (live mode drives the preset table); rendered headlessly.')
  if (input.fullPage) headlessOnly.push('fullPage is headless-only; rendered headlessly instead of driving the app.')
  const liveNotes = input.waitMs !== undefined ? ['waitMs is headless-only and was ignored in live mode.'] : []
  const plan = planLive(mode, headlessOnly, liveNotes, env, platform)
  if (plan.path === 'headless' && input.capture === 'pane') plan.notes.push(PANE_CAPTURE_HEADLESS_NOTE)
  return plan
}
```

Keep `APP_NOT_REACHABLE` exported (drive still uses it until Task 10). Ensure `PANE_CAPTURE_HEADLESS_NOTE` is exported.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --project unit tests/unit/mcpLib.test.ts`
Expected: PASS. `npm run typecheck` will fail in `server.ts` where `planSnapPath` is called with the old arity — Task 6 fixes it; for now change that call to `planSnapPath(input, requestedMode, process.env, process.platform)` and replace `plan.path === 'live' && live` with `plan.path === 'live' && live !== null`, keeping the old fallback (`liveNotes = plan.notes`) so behaviour is unchanged until Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/lib.ts src/mcp/server.ts tests/unit/mcpLib.test.ts
git commit -m "feat(mcp): the headless decision is a pure table with a named reason

requested, headless-only, no-display — in that order — and live otherwise.
OBSRV_TEST=1 counts as no display, so the harness can never trigger a launch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Launching the app

**Files:**
- Create: `src/mcp/launch.ts`
- Test: `tests/unit/launch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LaunchTarget =
    | { kind: 'bundle'; executable: string }              // <Obsrv.app>/Contents/MacOS/Obsrv
    | { kind: 'electron'; electron: string; entry: string } // package electron + out/main/index.js
  export function resolveLaunchTarget(platform, home, packageRoot, exists: (p: string) => boolean, resolveElectron: () => { path?: string; error?: string }): LaunchTarget | { error: string }
  export function launchApp(target: LaunchTarget, env: NodeJS.ProcessEnv, spawn = child_process.spawn): void
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/launch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { launchApp, resolveLaunchTarget } from '../../src/mcp/launch'

const ROOT = '/pkg'
const HOME = '/Users/x'

describe('resolveLaunchTarget', () => {
  it('prefers the installed bundle: the Dock icon, the update check, the user\'s own install', () => {
    const exists = (p: string): boolean => p === '/Applications/Obsrv.app/Contents/MacOS/Obsrv'
    expect(resolveLaunchTarget('darwin', HOME, ROOT, exists, () => ({ path: '/e' }))).toEqual({
      kind: 'bundle',
      executable: '/Applications/Obsrv.app/Contents/MacOS/Obsrv',
    })
  })
  it('then ~/Applications', () => {
    const exists = (p: string): boolean => p === `${HOME}/Applications/Obsrv.app/Contents/MacOS/Obsrv`
    expect(resolveLaunchTarget('darwin', HOME, ROOT, exists, () => ({ path: '/e' }))).toMatchObject({ kind: 'bundle' })
  })
  it('then the package\'s own Electron with the GUI entry', () => {
    const exists = (p: string): boolean => p === `${ROOT}/out/main/index.js`
    expect(resolveLaunchTarget('darwin', HOME, ROOT, exists, () => ({ path: '/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' }))).toEqual({
      kind: 'electron',
      electron: '/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
      entry: `${ROOT}/out/main/index.js`,
    })
  })
  it('says why when nothing can be launched', () => {
    expect(resolveLaunchTarget('darwin', HOME, ROOT, () => false, () => ({ error: 'no electron' }))).toEqual({
      error: expect.stringMatching(/no Obsrv\.app.*no electron/s),
    })
  })
  it('refuses on Windows: there is no build', () => {
    expect(resolveLaunchTarget('win32', HOME, ROOT, () => true, () => ({ path: '/e' }))).toEqual({ error: expect.stringMatching(/Windows/) })
  })
})

describe('launchApp', () => {
  it('spawns detached with agent control force-enabled, and lets go of the child', () => {
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref }))
    launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, { HOME: '/Users/x' }, spawn as never)
    expect(spawn).toHaveBeenCalledWith('/A/Obsrv', [], expect.objectContaining({ detached: true, stdio: 'ignore', env: expect.objectContaining({ OBSRV_AGENT_CONTROL: '1' }) }))
    expect(unref).toHaveBeenCalled()
  })
  it('electron target: the entry is the first argument, and ELECTRON_RUN_AS_NODE is cleared', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }))
    launchApp({ kind: 'electron', electron: '/E', entry: '/pkg/out/main/index.js' }, { ELECTRON_RUN_AS_NODE: '1' }, spawn as never)
    const [, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(args).toEqual(['/pkg/out/main/index.js'])
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
  it('never launches under the e2e harness', () => {
    const spawn = vi.fn()
    expect(() => launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, { OBSRV_TEST: '1' }, spawn as never)).toThrow(/OBSRV_TEST/)
    expect(spawn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/launch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/mcp/launch.ts`:

```ts
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launching the desktop app from the MCP server (live-first spec §2a). The
 * resolution prefers the user's own install — the Dock icon, the update
 * check — and falls back to the Electron this package ships with, running
 * the GUI entry the DMG runs. Windows has no build, so it is refused here
 * rather than failing somewhere less legible.
 *
 * The bundle's executable is spawned directly rather than through `open -a`:
 * whether `open` forwards the environment is version-dependent, and the
 * whole point of the launch is that `OBSRV_AGENT_CONTROL=1` reaches the app.
 */

export type LaunchTarget = { kind: 'bundle'; executable: string } | { kind: 'electron'; electron: string; entry: string }

const BUNDLE_EXECUTABLE = join('Obsrv.app', 'Contents', 'MacOS', 'Obsrv')

export function resolveLaunchTarget(
  platform: NodeJS.Platform,
  home: string,
  packageRoot: string,
  exists: (p: string) => boolean,
  resolveElectron: () => { path?: string; error?: string },
): LaunchTarget | { error: string } {
  if (platform === 'win32') return { error: 'the Obsrv app has no Windows build to launch' }
  const tried: string[] = []
  if (platform === 'darwin') {
    for (const dir of ['/Applications', join(home, 'Applications')]) {
      const executable = join(dir, BUNDLE_EXECUTABLE)
      if (exists(executable)) return { kind: 'bundle', executable }
      tried.push(join(dir, 'Obsrv.app'))
    }
  }
  const entry = join(packageRoot, 'out', 'main', 'index.js')
  const electron = resolveElectron()
  if (electron.path && exists(entry)) return { kind: 'electron', electron: electron.path, entry }
  return {
    error:
      `no Obsrv.app in ${tried.join(' or ') || 'the usual places'}, and the package cannot run its own: ` +
      `${electron.error ?? (exists(entry) ? 'electron missing' : `${entry} missing (run npm run build)`)}`,
  }
}

/** Spawns the app, detached, with agent control force-enabled for the session. */
export function launchApp(target: LaunchTarget, env: NodeJS.ProcessEnv, spawn: typeof nodeSpawn = nodeSpawn): void {
  // Belt and braces with `noDisplayReason`: a launch from inside the e2e
  // harness would start a real Obsrv against the developer's profile.
  if (env.OBSRV_TEST === '1') throw new Error('refusing to launch the app under OBSRV_TEST=1')
  const childEnv: NodeJS.ProcessEnv = { ...env, OBSRV_AGENT_CONTROL: '1' }
  // Must boot the real Electron runtime, not Node-mode (see bin/obsrv.js).
  delete childEnv.ELECTRON_RUN_AS_NODE
  const [command, args] = target.kind === 'bundle' ? [target.executable, []] : [target.electron, [target.entry]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', env: childEnv })
  child.unref()
}

/** The default resolution against the real filesystem and the package's own Electron. */
export function resolveDefaultTarget(): LaunchTarget | { error: string } {
  // bin/electronPath.js is plain CommonJS, shared with the CLI launcher.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveElectron } = require(resolve(__dirname, '..', '..', 'bin', 'electronPath.js')) as {
    resolveElectron: () => { path?: string; error?: string }
  }
  return resolveLaunchTarget(process.platform, homedir(), resolve(__dirname, '..', '..'), existsSync, resolveElectron)
}
```

`__dirname` here is `out/mcp/` at runtime (the MCP build outputs to `out/mcp`; confirm with `ls out/mcp` — if the compiled path differs, adjust the two `resolve(__dirname, '..', '..')` to reach the package root).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --project unit tests/unit/launch.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/launch.ts tests/unit/launch.test.ts
git commit -m "feat(mcp): resolve and launch the desktop app, detached, control force-enabled

Bundle first, the package's own Electron second, never on Windows, never
under the e2e harness.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `discover()` knows three states; `ensureLive()` gets to live or says why not

**Files:**
- Modify: `src/mcp/control.ts` (`discoverControl` at line ~98)
- Test: `tests/unit/mcpControl.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export type Discovery = { kind: 'live'; app: LiveApp } | { kind: 'declined'; pid: number } | { kind: 'absent' }
  export function discover(timeoutMs?: number): Promise<Discovery>
  export function discoverControl(timeoutMs?: number): Promise<LiveApp | null>   // kept: kind === 'live' ? app : null
  export type LiveResolution =
    | { path: 'live'; app: LiveApp; launched: boolean; notes: string[] }
    | { path: 'headless'; why: HeadlessWhy; notes: string[] }
  export interface EnsureDeps {
    discover: () => Promise<Discovery>
    launch: () => void | Promise<void>       // throws with a message when nothing can be launched
    sleep: (ms: number) => Promise<void>
    now: () => number
  }
  export function ensureLive(plan: LivePlan | HeadlessPlan, deps?: EnsureDeps, timeoutMs?: number): Promise<LiveResolution>
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/mcpControl.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ensureLive, type Discovery, type EnsureDeps } from '../../src/mcp/control'
import { DECLINED_NOTE, LAUNCH_TIMEOUT_MS, type LivePlan } from '../../src/mcp/lib'
import type { LiveApp } from '../../src/mcp/control'

const app = { info: { port: 1, token: 'a'.repeat(64) }, status: { url: 'https://x.test' } } as unknown as LiveApp
const LIVE: LivePlan = { path: 'live', notes: ['n'] }

function deps(sequence: Discovery[], launch: EnsureDeps['launch'] = () => undefined): EnsureDeps & { clock: number } {
  let t = 0
  const d = {
    clock: 0,
    discover: vi.fn(async () => sequence.shift() ?? ({ kind: 'absent' } as Discovery)),
    launch: vi.fn(launch),
    sleep: vi.fn(async (ms: number) => {
      t += ms
    }),
    now: () => t,
  }
  return d
}

describe('ensureLive', () => {
  it('a headless plan is returned as it is; nothing is discovered or launched', async () => {
    const d = deps([])
    const r = await ensureLive({ path: 'headless', why: 'requested', notes: [] }, d)
    expect(r).toEqual({ path: 'headless', why: 'requested', notes: [] })
    expect(d.discover).not.toHaveBeenCalled()
  })
  it('a live app is used as found', async () => {
    const d = deps([{ kind: 'live', app }])
    expect(await ensureLive(LIVE, d)).toEqual({ path: 'live', app, launched: false, notes: ['n'] })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('declined: headless, the note says who to ask, and nothing is launched', async () => {
    const d = deps([{ kind: 'declined', pid: 4 }])
    expect(await ensureLive(LIVE, d)).toEqual({ path: 'headless', why: 'declined', notes: ['n', DECLINED_NOTE] })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('absent: launches, waits, and uses the app once it answers — launched is true', async () => {
    const d = deps([{ kind: 'absent' }, { kind: 'absent' }, { kind: 'live', app }])
    const r = await ensureLive(LIVE, d)
    expect(d.launch).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ path: 'live', app, launched: true, notes: ['n'] })
  })
  it('absent, then the user declines in the consent bar: headless, declined', async () => {
    const d = deps([{ kind: 'absent' }, { kind: 'declined', pid: 4 }])
    expect(await ensureLive(LIVE, d)).toMatchObject({ path: 'headless', why: 'declined' })
  })
  it('absent and it never comes up: launch-timeout, and the note says how long it waited', async () => {
    const d = deps([])
    const r = await ensureLive(LIVE, d)
    expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
    expect(r.notes.join(' ')).toMatch(new RegExp(`${LAUNCH_TIMEOUT_MS / 1000} s`))
  })
  it('nothing to launch: launch-timeout with the launcher\'s reason', async () => {
    const d = deps([{ kind: 'absent' }], () => {
      throw new Error('no Obsrv.app anywhere')
    })
    const r = await ensureLive(LIVE, d)
    expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
    expect(r.notes.join(' ')).toMatch(/no Obsrv\.app anywhere/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/mcpControl.test.ts`
Expected: FAIL — `ensureLive` not exported.

- [ ] **Step 3: Implement**

In `src/mcp/control.ts`, add the imports and replace `discoverControl`:

```ts
import { isDisabledStance, ... } from '../shared/control'   // add isDisabledStance to the existing import
import { DECLINED_NOTE, LAUNCH_TIMEOUT_MS, type HeadlessPlan, type HeadlessWhy, type LivePlan } from './lib'
import { launchApp, resolveDefaultTarget } from './launch'

export type Discovery = { kind: 'live'; app: LiveApp } | { kind: 'declined'; pid: number } | { kind: 'absent' }

/**
 * What the discovery file says, in three words. `live`: a control-enabled app
 * answered `status`. `declined`: an app is running and control is off — ask
 * in the app, do not launch over it. `absent`: no file, a dead owner, or a
 * live file whose server does not answer (a crashed run's leftover).
 */
export async function discover(timeoutMs = 500): Promise<Discovery> {
  const file = controlFilePath()
  let raw: string
  try {
    const s = await stat(file)
    if (!controlFileModeOk(s.mode, process.platform)) return { kind: 'absent' }
    raw = await readFile(file, 'utf8')
  } catch {
    return { kind: 'absent' }
  }
  const info = parseControlFile(raw)
  if (!info) return { kind: 'absent' }
  const pid = info.pid
  if (pid !== undefined) {
    try {
      process.kill(pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return { kind: 'absent' }
    }
  }
  if (isDisabledStance(info)) return { kind: 'declined', pid: info.pid }
  try {
    const status = parseControlStatus(await controlCall(info, 'status', {}, timeoutMs))
    return status ? { kind: 'live', app: { info, status } } : { kind: 'absent' }
  } catch {
    return { kind: 'absent' }
  }
}

/** The old shape, for callers that only care whether an app is live. */
export async function discoverControl(timeoutMs = 500): Promise<LiveApp | null> {
  const d = await discover(timeoutMs)
  return d.kind === 'live' ? d.app : null
}

export type LiveResolution =
  | { path: 'live'; app: LiveApp; launched: boolean; notes: string[] }
  | { path: 'headless'; why: HeadlessWhy; notes: string[] }

export interface EnsureDeps {
  discover: () => Promise<Discovery>
  launch: () => void | Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const LAUNCH_POLL_MS = 250

const defaultDeps: EnsureDeps = {
  discover: () => discover(),
  launch: () => {
    const target = resolveDefaultTarget()
    if ('error' in target) throw new Error(target.error)
    launchApp(target, process.env)
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
}

/**
 * Gets to the live app or says why not (live-first spec §2). A headless plan
 * passes straight through. Otherwise: use a live app; respect a declined
 * one; launch an absent one and wait — for it to answer, or for the user to
 * decline in the consent bar — up to `timeoutMs`.
 */
export async function ensureLive(plan: LivePlan | HeadlessPlan, deps: EnsureDeps = defaultDeps, timeoutMs = LAUNCH_TIMEOUT_MS): Promise<LiveResolution> {
  if (plan.path === 'headless') return plan
  const first = await deps.discover()
  if (first.kind === 'live') return { path: 'live', app: first.app, launched: false, notes: plan.notes }
  if (first.kind === 'declined') return { path: 'headless', why: 'declined', notes: [...plan.notes, DECLINED_NOTE] }
  try {
    await deps.launch()
  } catch (e) {
    return {
      path: 'headless',
      why: 'launch-timeout',
      notes: [...plan.notes, `the Obsrv app could not be launched (${e instanceof Error ? e.message : String(e)}); rendered headlessly.`],
    }
  }
  const deadline = deps.now() + timeoutMs
  while (deps.now() < deadline) {
    await deps.sleep(LAUNCH_POLL_MS)
    const d = await deps.discover()
    if (d.kind === 'live') return { path: 'live', app: d.app, launched: true, notes: plan.notes }
    if (d.kind === 'declined') return { path: 'headless', why: 'declined', notes: [...plan.notes, DECLINED_NOTE] }
  }
  return {
    path: 'headless',
    why: 'launch-timeout',
    notes: [...plan.notes, `the Obsrv app was launched but did not answer within ${timeoutMs / 1000} s; rendered headlessly. It may still be starting — the next call will find it.`],
  }
}
```

Remove the interim `isDisabledStance` guard added in Task 1 Step 4 (it is now inside `discover`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --project unit && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/control.ts tests/unit/mcpControl.test.ts
git commit -m "feat(mcp): discover three states, and ensureLive launches or says why not

live / declined / absent. Absent is launched and waited on; a decline during
the wait is honoured; a timeout names how long it waited.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `obsrv_snap` goes live by default and says why when it does not

**Files:**
- Modify: `src/mcp/server.ts` (the snap handler at line ~885; `snapOutputShape` at ~236; the snap description at ~864 and the `mode` field description at ~229)
- Test: `tests/e2e/mcp.spec.ts`

**Interfaces:**
- Produces (result fields on every tool with `mode`, from this task on): `why?: HeadlessWhy` (present when `mode: 'headless'`), `launched?: true` (present when this call launched the app).

- [ ] **Step 1: Write the failing e2e test**

`tests/e2e/mcp.spec.ts` runs the MCP with `OBSRV_CONTROL_FILE` pointing at a non-existent file and inherits `OBSRV_TEST`? It does not — add it. In `test.beforeAll`, change the env to:

```ts
      env: { ...env, OBSRV_TEST: '1', OBSRV_CONTROL_FILE: resolve(ROOT, 'tests/fixtures/no-such-control.json') },
```

Then add a test after the tools/list test:

```ts
test('obsrv_snap under the harness is headless for a named reason, and never launches', async () => {
  const r = await call('obsrv_snap', { url: fixture('solid-red.html'), preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()
  const s = r.structuredContent as { mode: string; why?: string; launched?: boolean; warnings: string[] }
  expect(s.mode).toBe('headless')
  expect(s.why).toBe('no-display')
  expect(s.launched).toBeUndefined()
  expect(s.warnings.join(' ')).toMatch(/OBSRV_TEST/)
})

test('obsrv_snap mode: headless says requested; fullPage says headless-only', async () => {
  const a = (await call('obsrv_snap', { url: fixture('solid-red.html'), mode: 'headless' })).structuredContent as { why?: string }
  expect(a.why).toBe('requested')
  const b = (await call('obsrv_snap', { url: fixture('tall.html'), fullPage: true })).structuredContent as { why?: string }
  expect(b.why).toBe('headless-only')
})

test('obsrv_snap mode: live under the harness is an error naming the reason', async () => {
  const r = await call('obsrv_snap', { url: fixture('solid-red.html'), mode: 'live' })
  expect(r.isError).toBe(true)
  expect(JSON.stringify(r.content)).toMatch(/no display.*OBSRV_TEST/)
})
```

(`fixture(...)` — reuse the file's existing helper for `file://` URLs; if it is named differently, use that name.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/mcp.spec.ts -g "named reason|says requested|mode: live"`
Expected: FAIL — no `why` in the result.

- [ ] **Step 3: Implement**

In `src/mcp/server.ts`, replace the snap handler's live-path block with:

```ts
    const requestedMode = input.mode ?? 'auto'
    const plan = planSnapPath(input, requestedMode, process.env, process.platform)
    const resolved = await ensureLive(plan)
    if (resolved.path === 'live') return liveSnap(resolved.app, input, resolved.notes, resolved.launched)
    if (requestedMode === 'live') return toolError(`mode: "live" but the live app is not available (${resolved.why}): ${resolved.notes.join(' ')}`)
    const liveNotes = resolved.notes
    const why = resolved.why
```

and where `structured` is built for the headless result:

```ts
    const structured = { ...meta, mode: 'headless', why, warnings: [...cliWarnings, ...liveNotes], pngPath }
```

Change `liveSnap`'s signature to `(app: LiveApp, input: SnapToolInput, notes: string[], launched: boolean)` and add `...(launched ? { launched: true } : {})` to its structured result (find where it sets `mode: 'live'`).

Import `ensureLive` from `./control`. In `snapOutputShape` add:

```ts
  why: z
    .enum(['requested', 'headless-only', 'no-display', 'declined', 'launch-timeout'])
    .optional()
    .describe('Only when mode is headless: why. requested (you asked), headless-only (fullPage / custom dims), no-display (nowhere for a window), declined (the user turned agent control off in the app — ask them), launch-timeout (the app was launched but did not answer in time; the next call will likely find it).'),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app. Tell the user once: a window has opened.'),
```

Update the `mode` input description (line ~229) to:

```ts
      'auto (default): drive the visible Obsrv app, launching it if it is not running; headless only when asked, ' +
      'when the operation needs it (fullPage, custom dims), when there is no display, or when the user has turned ' +
      'agent control off in the app — the result says which (`why`). live: require the app (error naming the reason). ' +
      'headless: never touch the app.',
```

and the description paragraph at ~864 (`Live drive: when the Obsrv desktop app is open…`) to:

```ts
      `Live drive: \`mode: "auto"\` (the default) drives the *visible* app — the user watches the URL load and the ` +
      `preset flip — and launches the app if it is not running (\`launched: true\` on that call). The returned PNG is ` +
      `the app window as they see it. Headless only for a named reason (\`why\`). ...`
```

keeping the rest of that paragraph.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/mcp.spec.ts tests/e2e/mcp-live.spec.ts`
Expected: PASS. (`mcp-live.spec.ts` drives a real app under `OBSRV_AGENT_CONTROL=1`; with the app live, `ensureLive` returns it and nothing launches.)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/e2e/mcp.spec.ts
git commit -m "feat(mcp): obsrv_snap is live by default, launches the app, and names why when headless

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `audit`, `lint`, `inspect` follow

**Files:**
- Modify: `src/mcp/server.ts` (the three handlers at lines ~1119, ~1327, ~1820, each starting `const live = await discoverControl()`)
- Test: `tests/e2e/mcp.spec.ts`

**Interfaces:**
- Consumes: `ensureLive`, `planLive` (Task 3/5).
- Each handler builds `planLive(mode, headlessOnly, [], process.env, process.platform)` where `headlessOnly` is `['custom dimensions are headless-only; measured headlessly.']` when width/height are given, else `[]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/e2e/mcp.spec.ts`:

```ts
test('audit, lint and inspect name why they ran headless, like snap', async () => {
  const a = (await call('obsrv_audit', { url: fixture('audit.html'), preset: 'laptop-768' })).structuredContent as { mode: string; why?: string }
  const l = (await call('obsrv_lint', { url: fixture('lint.html'), preset: 'laptop-768' })).structuredContent as { mode: string; why?: string }
  const i = (await call('obsrv_inspect', { url: fixture('audit.html'), preset: 'laptop-768', selector: 'button' })).structuredContent as { mode: string; why?: string }
  for (const s of [a, l, i]) expect(s).toMatchObject({ mode: 'headless', why: 'no-display' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/e2e/mcp.spec.ts -g "name why"`
Expected: FAIL — `why` undefined.

- [ ] **Step 3: Implement**

In each of the three handlers, replace the `discoverControl` block. The pattern (audit shown; lint and inspect identical apart from the live function they call and the custom-dims check):

```ts
    const requestedMode = input.mode ?? 'auto'
    const custom = input.width !== undefined || input.height !== undefined
    const plan = planLive(requestedMode, custom ? ['custom dimensions are headless-only; measured headlessly.'] : [], [], process.env, process.platform)
    const resolved = await ensureLive(plan)
    if (resolved.path === 'live') return liveAudit(resolved.app, input, resolved.notes, resolved.launched)
    if (requestedMode === 'live') return toolError(`mode: "live" but the live app is not available (${resolved.why}): ${resolved.notes.join(' ')}`)
    const why = resolved.why
    const liveNotes = resolved.notes
```

Add `why` to each headless `structured` object and `launched` to each live one (same edit as Task 6 to the `liveAudit`/`liveLint`/`liveInspect` signatures). Add the `why`/`launched` fields to `auditOutputShape`, `lintOutputShape`, `inspectOutputShape` (copy the two zod fields from Task 6). Import `planLive`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/mcp.spec.ts tests/e2e/mcp-live.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/e2e/mcp.spec.ts
git commit -m "feat(mcp): audit, lint and inspect go live by default and name why when not

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The consent bar

**Files:**
- Modify: `src/shared/ipc.ts` (the `IPC` table), `src/shared/api.ts` (line ~217, next to `onAgentActivity`), `src/preload/app.ts` (line ~118)
- Modify: `src/main/ipc.ts` (near `applyAgentControl`), `src/main/index.ts` (`second-instance` at line 144)
- Create: `src/renderer/src/components/ConsentBar.tsx`
- Modify: `src/renderer/src/App.tsx` (mount under `<Toolbar …/>` at line ~408), `src/renderer/src/styles.css`
- Test: `tests/e2e/consent.spec.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  IPC.agentConsentRequest = 'obsrv:agent-consent-request'   // main → renderer, no payload
  IPC.agentConsent        = 'obsrv:agent-consent'           // renderer → main, boolean
  window.obsrv.onAgentConsentRequest(cb: () => void): () => void
  window.obsrv.agentConsent(allow: boolean): void
  // main/ipc.ts
  export const hooks = { secondInstance: (): void => {} }   // reassigned by setup
  ```

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/consent.spec.ts`:

```ts
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * The one state where the app can ask (live-first spec §2c): open, control
 * off, and a second launch knocks. `second-instance` is raised synthetically
 * through the test hook rather than by spawning a second Electron.
 */

let app: ElectronApplication
let page: Page
let controlFile: string

const stance = (): 'live' | 'declined' | 'absent' => {
  if (!existsSync(controlFile)) return 'absent'
  const f = parseControlFile(readFileSync(controlFile, 'utf8'))
  return !f ? 'absent' : isDisabledStance(f) ? 'declined' : 'live'
}
const knock = (): Promise<void> => app.evaluate(() => (globalThis as any).__obsrv.hooks.secondInstance())

test.beforeAll(async () => {
  app = await launchApp() // control off: the saved default
  page = await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  controlFile = join(userData, CONTROL_FILE_NAME)
})
test.afterAll(async () => {
  await app.close()
})

test('control off: the app writes a disabled stance, and no bar shows until someone knocks', async () => {
  await expect.poll(stance).toBe('declined')
  await expect(page.locator('.consent-bar')).toHaveCount(0)
})

test('a knock shows the bar with the agreed copy; a second knock does not stack a second bar', async () => {
  await knock()
  await expect(page.locator('.consent-bar')).toBeVisible()
  await expect(page.locator('.consent-bar')).toContainText('An agent wants to drive Obsrv.')
  await expect(page.locator('.consent-bar button', { hasText: 'Allow for this session' })).toBeVisible()
  await expect(page.locator('.consent-bar button', { hasText: 'Not now' })).toBeVisible()
  await knock()
  await expect(page.locator('.consent-bar')).toHaveCount(1)
})

test('Not now: the bar goes, the stance stays declined, the saved setting is untouched', async () => {
  await page.locator('.consent-bar button', { hasText: 'Not now' }).click()
  await expect(page.locator('.consent-bar')).toHaveCount(0)
  expect(stance()).toBe('declined')
  expect(await app.evaluate(() => (globalThis as any).__obsrv.settings().agentControl)).toBe(false)
})

test('Allow for this session: control on, the file is live, the toggle reads on, nothing persisted', async () => {
  await knock()
  await page.locator('.consent-bar button', { hasText: 'Allow for this session' }).click()
  await expect(page.locator('.consent-bar')).toHaveCount(0)
  await expect.poll(stance).toBe('live')
  await expect(page.locator('button.agent-activity')).toBeVisible()
  // In memory, not on disk: the same rule as OBSRV_AGENT_CONTROL=1.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.settings().agentControl)).toBe(true)
  expect(await app.evaluate(() => (globalThis as any).__obsrv.persistedSettings().agentControl)).toBe(false)
})

test('with control on, a knock shows nothing: the app is already driveable', async () => {
  await knock()
  await expect(page.locator('.consent-bar')).toHaveCount(0)
})
```

`__obsrv.settings()` / `__obsrv.persistedSettings()` / `__obsrv.hooks` — add to the test hook in `src/main/ipc.ts` where `globalThis.__obsrv` is published under `OBSRV_TEST === '1'` (search `__obsrv` in `src/main/ipc.ts`; add `hooks`, `settings: () => settings`, `persistedSettings: () => readSettingsFromDisk()` using whatever the file already uses to load settings — search for the settings read at boot).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/consent.spec.ts`
Expected: FAIL — no `hooks`, no `.consent-bar`.

- [ ] **Step 3: Channels and preload**

`src/shared/ipc.ts`, next to `agentActivity`:

```ts
  /** Main -> chrome: a second launch knocked while agent control is off; ask the user. */
  agentConsentRequest: 'obsrv:agent-consent-request',
  /** Chrome -> main: the user's answer, `true` to allow for this session. */
  agentConsent: 'obsrv:agent-consent',
```

`src/shared/api.ts`, next to `onAgentActivity`:

```ts
  onAgentConsentRequest(cb: () => void): () => void
  agentConsent(allow: boolean): void
```

`src/preload/app.ts`, next to `onAgentActivity`:

```ts
  onAgentConsentRequest: cb => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.agentConsentRequest, listener)
    return () => {
      ipcRenderer.removeListener(IPC.agentConsentRequest, listener)
    }
  },
  agentConsent: allow => ipcRenderer.send(IPC.agentConsent, allow === true),
```

- [ ] **Step 4: Main**

In `src/main/ipc.ts`, at module level (top, after imports):

```ts
/**
 * Hooks index.ts calls into this module's setup closure. `second-instance`
 * is registered in index.ts before the window exists; the control server and
 * the settings live in here.
 */
export const hooks = {
  secondInstance: (): void => {},
}
```

Inside setup, after `applyAgentControl` is defined:

```ts
  // A second launch — the MCP server trying to start the app because it found
  // no live control — is the one moment the app can ask the user (spec §2c).
  // Only while control is off: with it on, the knock has nothing to add.
  hooks.secondInstance = () => {
    if (control.running || win.isDestroyed()) return
    win.webContents.send(IPC.agentConsentRequest)
  }
  on(IPC.agentConsent, (e, allow: unknown) => {
    assertRenderer(e)
    if (allow !== true) {
      // Not now: the stance is already disabled on disk; nothing to write.
      return
    }
    // For this session, exactly as OBSRV_AGENT_CONTROL=1: in memory, and the
    // toolbar reflects it; nothing persists until the next settings write.
    settings = { ...settings, agentControl: true }
    applyAgentControl(true)
    win.webContents.send(IPC.settingsChanged, settings)   // if no such channel exists, add it: main -> chrome, the whole Settings object; the renderer store replaces its copy
  })
```

If `IPC.settingsChanged` does not exist, add it to `ipc.ts`/`api.ts`/preload (`onSettingsChanged(cb: (s: Settings) => void)`) and subscribe once in `App.tsx` with `useStore.getState().setSettings(s)`.

In `src/main/index.ts`, import `{ hooks }` from `'./ipc'` and in the `second-instance` handler, before the window focus lines:

```ts
    hooks.secondInstance()
```

- [ ] **Step 5: Renderer**

Create `src/renderer/src/components/ConsentBar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../state/store'

/**
 * The only new UI of the live-first spec: shown when a second launch knocks
 * while agent control is off. Non-modal, under the toolbar, names that an
 * *agent* is asking. `Allow` is for this session only; `Not now` leaves the
 * app exactly as it was.
 */
export function ConsentBar(): JSX.Element | null {
  const [asked, setAsked] = useState(false)
  const agentControl = useStore(s => s.settings.agentControl)

  useEffect(() => window.obsrv.onAgentConsentRequest(() => setAsked(true)), [])
  // The user turned it on some other way while the bar was up.
  useEffect(() => {
    if (agentControl) setAsked(false)
  }, [agentControl])

  if (!asked || agentControl) return null

  const answer = (allow: boolean): void => {
    setAsked(false)
    if (allow) {
      const current = useStore.getState().settings
      useStore.getState().setSettings({ ...current, agentControl: true })
    }
    window.obsrv.agentConsent(allow)
  }

  return (
    <div className="consent-bar" role="status">
      <span>An agent wants to drive Obsrv.</span>
      <button type="button" className="consent-allow" onClick={() => answer(true)}>
        Allow for this session
      </button>
      <button type="button" className="consent-deny" onClick={() => answer(false)}>
        Not now
      </button>
    </div>
  )
}
```

In `App.tsx`, import it and render it directly after `<Toolbar … />`:

```tsx
      <ConsentBar />
```

In `styles.css`, after the `.agent-activity` rules:

```css
.consent-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: var(--warn-bg, rgba(255, 180, 0, 0.12));
  border-bottom: 1px solid var(--warn);
  font-size: 12px;
}
.consent-bar button { font: inherit; padding: 3px 10px; border-radius: 4px; border: 1px solid var(--warn); background: transparent; cursor: pointer; }
.consent-bar .consent-allow { background: var(--warn); color: var(--chrome-0); }
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/consent.spec.ts tests/e2e/live-drive.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/app.ts src/main/ipc.ts src/main/index.ts src/renderer/src/components/ConsentBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/e2e/consent.spec.ts
git commit -m "feat(app): a second launch with control off asks the user, in the app

The consent bar: Allow for this session (in memory, as OBSRV_AGENT_CONTROL=1)
or Not now (the disabled stance stands). Never modal, never stacked.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Tabs as control commands

**Files:**
- Modify: `src/shared/control.ts` (`CONTROL_COMMANDS` at 185; `ControlStatus` at 106; `parseControlStatus` at 486)
- Modify: `src/main/controlServer.ts` (`ControlDeps`; the `switch`)
- Modify: `src/main/ipc.ts` (the `new ControlServer(…, { … })` deps at ~1271)
- Test: `tests/unit/control.test.ts`, `tests/e2e/live-drive.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/control.ts
  export interface ControlTab { id: string; url: string; title: string; presetId: string; active: boolean }
  ControlStatus.tabs: ControlTab[]      // [] from an app older than the field
  export function parseOpenTab(raw: unknown): { url?: string; preset?: string } | string
  export function parseTabId(raw: unknown): string | string   // the id, or an error message
  // controlServer ControlDeps
  tabs(): { tabs: ControlTab[]; maxTabs: number }
  openTab(): string | null            // the new, now-active tab's id; null at the cap
  activateTab(id: string): boolean
  closeTab(id: string): { ok: true; activeId: string } | { ok: false; error: string }
  ```
- Replies: `tabs` → `{ ok, tabs, maxTabs }`; `openTab` → `{ ok, id }`; `activateTab` → `{ ok, id }`; `closeTab` → `{ ok, closed, active }`.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/control.test.ts`:

```ts
describe('tab commands', () => {
  it('are control commands', () => {
    for (const c of ['tabs', 'openTab', 'activateTab', 'closeTab']) expect(isControlCommand(c)).toBe(true)
  })
  it('parseOpenTab: optional url and preset, both checked', () => {
    expect(parseOpenTab({})).toEqual({})
    expect(parseOpenTab({ url: ' https://x.test ' })).toEqual({ url: 'https://x.test' })
    expect(parseOpenTab({ preset: 'laptop-768' })).toEqual({ preset: 'laptop-768' })
    expect(parseOpenTab({ preset: 'nope' })).toMatch(/preset/)
    expect(parseOpenTab({ url: 'javascript:alert(1)' })).toMatch(/scheme/)
  })
  it('parseTabId: a non-empty string', () => {
    expect(parseTabId({ id: 'tab-3' })).toBe('tab-3')
    expect(parseTabId({})).toMatch(/id/)
    expect(parseTabId({ id: '' })).toMatch(/id/)
  })
  it('parseControlStatus carries tabs, and defaults to none for an older app', () => {
    const base = { version: '1', url: 'https://x.test', presetId: 'p', profileId: 'r', viewMode: 'fit', mode: 'url' }
    expect(parseControlStatus(base)?.tabs).toEqual([])
    const tabs = [{ id: 'a', url: 'https://x.test', title: 'X', presetId: 'p', active: true }]
    expect(parseControlStatus({ ...base, tabs })?.tabs).toEqual(tabs)
    expect(parseControlStatus({ ...base, tabs: [{ id: 1 }] })).toBeNull()
  })
})
```

Import `parseOpenTab`, `parseTabId`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/control.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the shared side**

In `src/shared/control.ts`:

Add to `CONTROL_COMMANDS` before `] as const`:

```ts
  // live-first: tabs as an agent surface.
  'tabs',
  'openTab',
  'activateTab',
  'closeTab',
```

Add after `ControlStatus`'s fields: `tabs: ControlTab[]` and the interface:

```ts
/** One tab as `status` and `tabs` list it. */
export interface ControlTab {
  id: string
  url: string
  title: string
  presetId: string
  active: boolean
}
```

Add the validators (near `parseClick`); `urlSchemeError` lives in `src/mcp/lib.ts` and cannot be imported here (shared must not depend on mcp) — the scheme check is done in `controlServer.ts` where `urlSchemeError` is already imported:

```ts
export function parseOpenTab(raw: unknown): { url?: string; preset?: string } | string {
  if (!isRecord(raw)) return 'openTab payload must be an object'
  const out: { url?: string; preset?: string } = {}
  if (raw.url !== undefined) {
    if (typeof raw.url !== 'string' || raw.url.trim() === '') return 'openTab url must be a non-empty string'
    out.url = raw.url.trim()
  }
  if (raw.preset !== undefined) {
    const bad = presetApplyError(raw.preset)
    if (bad) return bad
    out.preset = raw.preset as string
  }
  return out
}

export function parseTabId(raw: unknown): string {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return 'payload must be { id: string } naming a tab from `tabs`'
  return raw.id
}
```

(`parseTabId` returns the id or an error string; the server tells them apart by checking membership in the tab list, so make the error start with `payload must be` and have the caller test `startsWith('payload must be')` — or return `{ id } | string`. Use the latter for clarity: `export function parseTabId(raw: unknown): { id: string } | string`.) Update the unit test's expectations to `toEqual({ id: 'tab-3' })`.

In `parseControlStatus`, before `return {`:

```ts
  const tabsRaw = raw.tabs ?? []
  if (!Array.isArray(tabsRaw)) return null
  const tabs: ControlTab[] = []
  for (const t of tabsRaw) {
    if (!isRecord(t)) return null
    const { id, url, title, presetId, active } = t
    if (typeof id !== 'string' || typeof url !== 'string' || typeof title !== 'string' || typeof presetId !== 'string' || typeof active !== 'boolean') return null
    tabs.push({ id, url, title, presetId, active })
  }
```

and add `tabs,` to the returned object. The scheme check for `openTab.url` uses `urlSchemeError` in the server case (below).

- [ ] **Step 4: Server and deps**

`src/main/controlServer.ts`, in `ControlDeps`:

```ts
  /** The strip as the user sees it, and the cap. */
  tabs(): { tabs: ControlTab[]; maxTabs: number }
  /** Opens a tab and brings it to the front; null at the cap. */
  openTab(): string | null
  /** Brings a tab to the front; false when no tab has that id. */
  activateTab(id: string): boolean
  /** Closes a tab; refuses the last one. */
  closeTab(id: string): { ok: true; activeId: string } | { ok: false; error: string }
```

Cases, after `case 'status'`:

```ts
      case 'tabs':
        return reply(200, { ok: true, ...this.deps.tabs() })

      case 'openTab': {
        const req = parseOpenTab(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        if (req.url !== undefined) {
          const bad = urlSchemeError(req.url)
          if (bad) return reply(400, { error: bad })
        }
        const id = this.deps.openTab()
        if (id === null) return reply(409, { error: `the app is at its tab limit (${this.deps.tabs().maxTabs}); close one first` })
        // The new tab is in front now, so the ordinary paths land on it.
        if (req.preset !== undefined) this.deps.apply({ presetId: req.preset })
        if (req.url !== undefined) await this.deps.navigate(req.url)
        return reply(200, { ok: true, id })
      }

      case 'activateTab': {
        const req = parseTabId(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        if (!this.deps.activateTab(req.id)) return reply(404, { error: `no tab ${req.id}; see \`tabs\`` })
        return reply(200, { ok: true, id: req.id })
      }

      case 'closeTab': {
        const req = parseTabId(payload)
        if (typeof req === 'string') return reply(400, { error: req })
        const r = this.deps.closeTab(req.id)
        if (!r.ok) return reply(409, { error: r.error })
        return reply(200, { ok: true, closed: req.id, active: r.activeId })
      }
```

`status` gains tabs: change `case 'status'` to `return reply(200, { ok: true, ...this.deps.status(), tabs: this.deps.tabs().tabs })`.

`src/main/ipc.ts`, in the `new ControlServer(…, { … })` deps object:

```ts
    tabs: () => {
      const snap = tabs.snapshot()
      return {
        maxTabs: tabs.maxTabs,
        tabs: snap.tabs.map(t => ({ id: t.id, url: t.url, title: t.title, presetId: t.presetId, active: t.id === snap.activeId })),
      }
    },
    openTab: () => {
      const s = tabs.add()
      if (!s) return null
      tabs.activate(s.id)
      return s.id
    },
    activateTab: id => {
      if (!tabs.snapshot().tabs.some(t => t.id === id)) return false
      tabs.activate(id)
      return true
    },
    closeTab: id => {
      const snap = tabs.snapshot()
      if (!snap.tabs.some(t => t.id === id)) return { ok: false, error: `no tab ${id}; see \`tabs\`` }
      if (snap.tabs.length === 1) return { ok: false, error: 'the last tab cannot be closed; open another first' }
      tabs.close(id)
      return { ok: true, activeId: tabs.activeId }
    },
```

(`tabs.maxTabs` and `tabs.activeId` exist — `status` already reads `tabs.activeId`, and the settings handler writes `tabs.maxTabs`.) Check how the tab strip's own "new tab" button reaches main (search `handle(IPC.` near `tabs.add()` in `ipc.ts`) and, if it does more than `add`+`activate` (a navigation to a start page, say), do the same in `openTab`.

- [ ] **Step 5: E2E**

Append to `tests/e2e/live-drive.spec.ts`:

```ts
test('tabs: list, open, activate, close — and the last tab is refused', async () => {
  const before = await call('tabs')
  expect(before.status).toBe(200)
  const first = (before.body.tabs as Array<{ id: string; active: boolean }>)
  expect(first).toHaveLength(1)
  expect(first[0]!.active).toBe(true)

  const opened = await call('openTab', { url: FIXTURE, preset: 'laptop-768' })
  expect(opened.status).toBe(200)
  const id = opened.body.id as string
  await expect.poll(async () => ((await call('status')).body as { tabId: string }).tabId).toBe(id)
  expect((await call('status')).body).toMatchObject({ presetId: 'laptop-768' })
  await expect(page.locator('.tab')).toHaveCount(2)

  const back = await call('activateTab', { id: first[0]!.id })
  expect(back.status).toBe(200)
  await expect.poll(async () => ((await call('status')).body as { tabId: string }).tabId).toBe(first[0]!.id)

  expect((await call('activateTab', { id: 'no-such' })).status).toBe(404)

  const closed = await call('closeTab', { id })
  expect(closed.status).toBe(200)
  await expect(page.locator('.tab')).toHaveCount(1)
  const last = await call('closeTab', { id: first[0]!.id })
  expect(last.status).toBe(409)
  expect(String(last.body.error)).toMatch(/last tab/)
})
```

- [ ] **Step 6: Run everything**

Run: `npx vitest run --project unit && npm run typecheck && npm run build && npx playwright test tests/e2e/live-drive.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/control.ts src/main/controlServer.ts src/main/ipc.ts tests/unit/control.test.ts tests/e2e/live-drive.spec.ts
git commit -m "feat(control): tabs, openTab, activateTab, closeTab — over the manager the strip already uses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `obsrv_drive` gets `tab`, `closeTab` and `tabs`, and launches like the rest

**Files:**
- Modify: `src/mcp/server.ts` (drive input shape at ~1600, `driveOutputShape`, the handler at 1638)
- Test: `tests/e2e/mcp-live.spec.ts`

**Interfaces:**
- Consumes: `ensureLive`, `planLive`; control commands from Task 9.
- Produces: drive input `tab?: string` (`"new"` or an id), `closeTab?: string` (`"current"` or an id); output `tabs: ControlTab[]`, `launched?: true`.

- [ ] **Step 1: Write the failing e2e test**

In `tests/e2e/mcp-live.spec.ts` (it drives a real app; follow its existing `call` helper), add:

```ts
test('obsrv_drive: tab "new" opens and fronts a tab with the url and preset; closeTab "current" closes it last', async () => {
  const opened = (await call('obsrv_drive', { tab: 'new', url: fixture('tall.html'), preset: 'laptop-768', capture: 'pane' })).structuredContent as {
    tabId: string
    presetId: string
    tabs: Array<{ id: string; active: boolean }>
    pngPath: string
  }
  expect(opened.tabs).toHaveLength(2)
  expect(opened.tabs.find(t => t.active)!.id).toBe(opened.tabId)
  expect(opened.presetId).toBe('laptop-768')
  expect(opened.pngPath).toMatch(/\.png$/)

  const closed = (await call('obsrv_drive', { closeTab: 'current' })).structuredContent as { tabs: unknown[]; tabId: string }
  expect(closed.tabs).toHaveLength(1)
  expect(closed.tabId).not.toBe(opened.tabId)
})

test('obsrv_drive: tab <id> activates before anything else runs', async () => {
  const a = (await call('obsrv_drive', { tab: 'new', url: fixture('solid-red.html') })).structuredContent as { tabId: string; tabs: Array<{ id: string }> }
  const other = a.tabs.find(t => t.id !== a.tabId)!.id
  const b = (await call('obsrv_drive', { tab: other, capture: 'pane' })).structuredContent as { tabId: string }
  expect(b.tabId).toBe(other)
  await call('obsrv_drive', { closeTab: a.tabId })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/mcp-live.spec.ts -g "tab"`
Expected: FAIL — unknown input `tab`.

- [ ] **Step 3: Implement**

Input schema (the `driveInputShape` object): add

```ts
  tab: z
    .string()
    .optional()
    .describe('Runs first. "new" opens a tab (with `url` and `preset` from this call, if given) and brings it to the front; a tab id from `tabs` brings that tab to the front. Either way the user is looking at the tab everything else in this call acts on.'),
  closeTab: z
    .string()
    .optional()
    .describe('Runs last, after `capture`: "current" closes the tab in front, an id closes that one. The last tab is refused. Photograph and close in one call.'),
```

Output shape: add

```ts
  tabs: z.array(z.object({ id: z.string(), url: z.string(), title: z.string(), presetId: z.string(), active: z.boolean() })).describe('Every open tab, and which is in front. Empty from an app older than tabs.'),
  launched: z.boolean().optional().describe('True on the one call that launched the Obsrv app.'),
```

Handler: replace

```ts
    const live = await discoverControl()
    if (!live) return toolError(APP_NOT_REACHABLE)
```

with

```ts
    const resolved = await ensureLive(planLive('live', [], [], process.env, process.platform))
    if (resolved.path === 'headless') return toolError(`obsrv_drive needs the live app and it is not available (${resolved.why}): ${resolved.notes.join(' ')}`)
    const live = resolved.app
```

Add the handler's input type fields `tab?: string; closeTab?: string`. At the top of the `try`, before `focus`:

```ts
      let openedWithUrl = false
      let openedWithPreset = false
      if (input.tab === 'new') {
        const payload: Record<string, unknown> = {}
        if (input.url !== undefined) {
          payload.url = input.url.trim()
          openedWithUrl = true
        }
        if (input.preset !== undefined) {
          payload.preset = input.preset
          openedWithPreset = true
        }
        await controlCall(live.info, 'openTab', payload, DEFAULT_TIMEOUT_MS + 10_000)
      } else if (input.tab !== undefined) {
        await controlCall(live.info, 'activateTab', { id: input.tab }, LIVE_APPLY_TIMEOUT_MS)
      }
```

Guard the later `url` and `preset` steps: `if (input.url !== undefined && !openedWithUrl)` and `if (input.preset !== undefined && !openedWithPreset)`.

After the capture block and before the final `status`:

```ts
      if (input.closeTab !== undefined) {
        const id = input.closeTab === 'current' ? (parseControlStatus(await controlCall(live.info, 'status', {}, LIVE_STATUS_TIMEOUT_MS))?.tabId ?? '') : input.closeTab
        if (id === '') return toolError('closeTab: the app did not name its tab')
        await controlCall(live.info, 'closeTab', { id }, LIVE_APPLY_TIMEOUT_MS)
      }
```

`status` (already parsed with `parseControlStatus`) now carries `tabs`; `structured` spreads it, so add `...(resolved.launched ? { launched: true } : {})` to `structured`.

Update the description's order sentence to: `tab → focus → url → preset → orientation → textScale → onionSkin → throttle → profile → viewMode → panes → vision → pixelExact → reload → back → forward → scroll → panTo → click → highlight → capture → closeTab`, and replace the truncated "Tabs:" paragraph with:

```ts
      `Tabs: the app holds several sessions as tabs, each with its own URL, screen and page state. Commands act on the ` +
      `tab in front; \`tab\` brings one there first ("new" opens it), \`closeTab\` closes one last, and the result's \`tabs\` ` +
      `lists them all. One tab per screen, left open for the user to flip through, is the natural shape of a review.\n\n` +
      `The app is launched if it is not running. If the user has turned agent control off (the AGENT chip, or Settings), ` +
      `this errors with why: "declined" — ask them, do not retry.`,
```

Replace `APP_NOT_REACHABLE` usage; if nothing else uses it, delete it from `lib.ts` and its test.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/mcp-live.spec.ts tests/e2e/mcp.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/lib.ts tests/unit/mcpLib.test.ts tests/e2e/mcp-live.spec.ts
git commit -m "feat(mcp): obsrv_drive opens, fronts and closes tabs, lists them, and launches the app

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: A page-wise scroll

**Files:**
- Modify: `src/shared/types.ts` (`ScrollRequest` at 150, `ScrollReport` at 156), `src/shared/ipcPayloads.ts` (`parseScrollRequest`, `parseScrollReport`), `src/preload/sync.ts` (the `APPLY_SCROLL` listener), `src/main/controlServer.ts` (`case 'scroll'`), `src/mcp/server.ts` (drive `scroll` input/output)
- Test: `tests/unit/ipcPayloads.test.ts`, `tests/e2e/live-drive.spec.ts`, `tests/e2e/mcp-live.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ScrollPage = 'next' | 'prev' | 'top' | 'bottom'
  ScrollRequest.page?: ScrollPage      // when present, x/y are placeholders (0,0) and ignored
  ScrollReport.atEnd: boolean          // the scroller cannot go further down
  ```

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/ipcPayloads.test.ts` (create the describe if the file lacks one for scroll):

```ts
describe('parseScrollRequest: page form', () => {
  it('accepts page alone, with placeholder offsets', () => {
    expect(parseScrollRequest({ page: 'next' })).toEqual({ x: 0, y: 0, page: 'next' })
    expect(parseScrollRequest({ page: 'bottom', scrollSelector: 'main' })).toEqual({ x: 0, y: 0, page: 'bottom', selector: 'main' })
  })
  it('rejects an unknown page and a page beside offsets', () => {
    expect(parseScrollRequest({ page: 'up' })).toMatch(/page/)
    expect(parseScrollRequest({ page: 'next', x: 10, y: 10 })).toMatch(/either/)
  })
})
describe('parseScrollReport: atEnd', () => {
  it('reads atEnd, defaulting to false for an older preload', () => {
    expect(parseScrollReport({ id: 1, x: 0, y: 700, scroller: 'root', warnings: [], atEnd: true })).toMatchObject({ atEnd: true })
    expect(parseScrollReport({ id: 1, x: 0, y: 700, scroller: 'root', warnings: [] })).toMatchObject({ atEnd: false })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/ipcPayloads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Shared types and parsers**

`src/shared/types.ts`:

```ts
export type ScrollPage = 'next' | 'prev' | 'top' | 'bottom'
export const SCROLL_PAGES: readonly ScrollPage[] = ['next', 'prev', 'top', 'bottom']

export interface ScrollRequest extends ScrollPos {
  id?: number
  selector?: string
  /** A screenful of the scroller in this direction, or an end. `x`/`y` are placeholders when set. */
  page?: ScrollPage
}

export interface ScrollReport {
  id: number
  x: number
  y: number
  scroller: ScrollerKind
  warnings: string[]
  /** The scroller can go no further down: the loop that walks a page stops here. */
  atEnd: boolean
}
```

`src/shared/ipcPayloads.ts`, `parseScrollRequest`:

```ts
export function parseScrollRequest(raw: unknown): ScrollRequest | string {
  if (!isRecord(raw)) return 'scroll payload must be an object'
  const page = raw.page
  const hasOffsets = raw.x !== undefined || raw.y !== undefined
  if (page !== undefined) {
    if (!(SCROLL_PAGES as readonly unknown[]).includes(page)) return `scroll page must be one of ${SCROLL_PAGES.join(', ')}`
    if (hasOffsets) return 'scroll takes either { page } or { x, y }, not both'
  }
  const pos = page !== undefined ? { x: 0, y: 0 } : parseScrollPos(raw)
  if (!pos) return 'scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets, or { page }'
  const out: ScrollRequest = { ...pos, ...(page !== undefined ? { page: page as ScrollPage } : {}) }
  const selector = raw.scrollSelector
  if (selector === undefined || selector === null) return out
  if (typeof selector !== 'string') return 'scrollSelector must be a CSS selector string'
  const trimmed = selector.trim()
  if (trimmed === '') return 'scrollSelector must not be empty'
  if (trimmed.length > MAX_SCROLL_SELECTOR) return `scrollSelector must be at most ${MAX_SCROLL_SELECTOR} characters`
  return { ...out, selector: trimmed }
}
```

`parseScrollReport`: read `atEnd: raw.atEnd === true` into the returned object.

- [ ] **Step 4: The preload**

In `src/preload/sync.ts`, inside the `APPLY_SCROLL` listener, compute the position first. Replace `const pos = { x: req.x, y: req.y }` with:

```ts
  /** The screenful for a page-wise request, against whichever scroller will take it. */
  const pageTarget = (el: Element | null): ScrollPos => {
    const cur = el ? { x: el.scrollLeft, y: el.scrollTop } : { x: window.scrollX, y: window.scrollY }
    const view = el ? el.clientHeight : window.innerHeight
    const max = Math.max(0, (el ? el.scrollHeight : document.documentElement.scrollHeight) - view)
    switch (req.page) {
      case 'next':
        return { x: cur.x, y: Math.min(cur.y + view, max) }
      case 'prev':
        return { x: cur.x, y: Math.max(cur.y - view, 0) }
      case 'top':
        return { x: cur.x, y: 0 }
      case 'bottom':
        return { x: cur.x, y: max }
      default:
        return cur
    }
  }
  const atEndOf = (el: Element | null, reached: ScrollPos): boolean => {
    const view = el ? el.clientHeight : window.innerHeight
    const max = Math.max(0, (el ? el.scrollHeight : document.documentElement.scrollHeight) - view)
    return reached.y >= max - 1
  }
```

Then in the selector branch, after `el` is resolved and before `applyTo`: `const pos = req.page ? pageTarget(el) : { x: req.x, y: req.y }`; in the default branch likewise after `const el = resolveScroller()`. (Move the `let`/`const pos` accordingly; `lastApplied = pos` stays where it is, now using the computed `pos`.) The report send becomes:

```ts
    ipcRenderer.send(SCROLL_RESULT, { id: req.id, x: reached.x, y: reached.y, scroller, warnings, atEnd: atEndOf(scrollerEl, reached) } satisfies ScrollReport)
```

where `scrollerEl` is the `Element | null` actually scrolled (keep it in a variable in both branches).

- [ ] **Step 5: Server and drive**

`controlServer.ts` `case 'scroll'` reply: add `atEnd: result.atEnd`.

`server.ts` drive input `scroll`: change to

```ts
  scroll: z
    .object({
      x: z.number().min(0).optional(),
      y: z.number().min(0).optional(),
      page: z.enum(['next', 'prev', 'top', 'bottom']).optional(),
      scrollSelector: z.string().min(1).max(512).optional(),
    })
    .optional()
    .describe('Either { x, y } (absolute page CSS px) or { page: "next" | "prev" | "top" | "bottom" } (one screenful of the scroller, or an end). Check `scrolled` and `atEnd` in the result: `atEnd` true is where a screenful-by-screenful review stops.'),
```

Output: `atEnd: z.boolean().optional().describe('Only when `scroll` was requested: the scroller can go no further down.')`. In the handler, read `r['atEnd'] === true` into `atEnd` and include `...(atEnd !== undefined ? { atEnd } : {})` in `structured` when `input.scroll !== undefined`.

- [ ] **Step 6: E2E**

`tests/e2e/live-drive.spec.ts`:

```ts
test('scroll page: next walks a screenful at a time and says when it is at the end', async () => {
  await call('navigate', { url: TALL })
  await call('setPreset', { id: 'laptop-768' })
  await call('scroll', { page: 'top' })
  const seen: number[] = []
  for (let i = 0; i < 20; i++) {
    const r = await call('scroll', { page: 'next' })
    expect(r.status).toBe(200)
    const y = (r.body.scrolled as { y: number }).y
    seen.push(y)
    if (r.body.atEnd === true) break
  }
  expect(seen.length).toBeGreaterThan(1)
  expect(seen.length).toBeLessThan(20)
  // Each step is a screenful (768) until the clamp.
  expect(seen[1]! - seen[0]!).toBeGreaterThanOrEqual(700)
  const back = await call('scroll', { page: 'prev' })
  expect((back.body.scrolled as { y: number }).y).toBeLessThan(seen[seen.length - 1]!)
  expect((await call('scroll', { page: 'next', x: 1, y: 1 })).status).toBe(400)
})
```

`tests/e2e/mcp-live.spec.ts`:

```ts
test('obsrv_drive scroll page: the review loop needs no arithmetic', async () => {
  await call('obsrv_drive', { url: fixture('tall.html'), preset: 'laptop-768', scroll: { page: 'top' } })
  let steps = 0
  for (;;) {
    const s = (await call('obsrv_drive', { scroll: { page: 'next' }, capture: 'pane' })).structuredContent as { atEnd?: boolean; pngPath: string }
    expect(s.pngPath).toMatch(/\.png$/)
    steps++
    if (s.atEnd || steps > 20) break
  }
  expect(steps).toBeGreaterThan(1)
  expect(steps).toBeLessThan(20)
})
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run --project unit && npm run typecheck && npm run build && npx playwright test tests/e2e/live-drive.spec.ts tests/e2e/mcp-live.spec.ts tests/e2e/sync.spec.ts`
Expected: PASS (`sync.spec` covers the offset form, which must be unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/shared/ipcPayloads.ts src/preload/sync.ts src/main/controlServer.ts src/mcp/server.ts tests/unit/ipcPayloads.test.ts tests/e2e/live-drive.spec.ts tests/e2e/mcp-live.spec.ts
git commit -m "feat(drive): scroll a screenful at a time, and say when the page is at its end

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The skill teaches the live loop; the docs stop calling tabs a limitation

**Files:**
- Modify: `skills/obsrv-screens/SKILL.md`
- Modify: `README.md` (the "Tabs are a first cut" bullet at line ~337; the live-drive section)
- Modify: `src/mcp/server.ts` (`report` and `diff` descriptions: one sentence each)
- Test: `tests/unit/plugin.test.ts` (the skill is shipped in the plugin; a text assertion keeps the loop in it)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/plugin.test.ts`:

```ts
describe('the skill teaches the live review loop', () => {
  const skill = readFileSync(join(root, 'skills/obsrv-screens/SKILL.md'), 'utf8')
  it('names the two paths and the loop', () => {
    expect(skill).toMatch(/## Review \(live\)/)
    expect(skill).toMatch(/## Deliver \(headless\)/)
    expect(skill).toMatch(/page: "next"/)
    expect(skill).toMatch(/atEnd/)
    expect(skill).toMatch(/tab: "new"/)
  })
  it('explains every headless reason an agent can be handed', () => {
    for (const why of ['requested', 'headless-only', 'no-display', 'declined', 'launch-timeout']) expect(skill).toContain(why)
    expect(skill).toContain('launched')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/unit/plugin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the skill's workflow section**

In `skills/obsrv-screens/SKILL.md`, replace the section that currently describes when to use snap/report/drive with two sections (keep the rest — presets, thresholds, the measured facts):

````markdown
## Review (live)

The user installed a window to watch. Review in it.

1. **One tab per screen.** `obsrv_drive { tab: "new", url, preset: "laptop-768", capture: "pane" }` — the app launches if it is not running (`launched: true` on that call; say so once). Repeat with `android-65`, `1080p-24`, whatever the question is about. Leave the tabs open; the user flips through them afterwards.
2. **Walk each page a screenful at a time.** `obsrv_drive { scroll: { page: "next" }, capture: "pane" }` until the result says `atEnd: true`. Look at each capture as it comes. No arithmetic, no page height.
3. **Point at what you mean.** `obsrv_drive { highlight: { …rect, space: "page" } }` with an `obsrv_audit` finding's rect or `obsrv_inspect`'s `pageRect`, while you talk about it. `obsrv_audit`, `obsrv_lint`, `obsrv_inspect` in `mode: "auto"` measure the tab in front.
4. **Switch with `tab: <id>`** (ids from any result's `tabs`); `closeTab: "current"` when a tab has served.

If a result says `mode: "headless"`, read `why` and tell the user in plain words:
- `requested` — you asked for headless.
- `headless-only` — `fullPage`, custom dims, `report`, `diff`: things the live app cannot do.
- `no-display` — nowhere for a window (SSH, CI, `OBSRV_HEADLESS=1`).
- `declined` — the user turned agent control off in the app (the AGENT chip, or Settings → Agent control). Ask them; do not retry.
- `launch-timeout` — the app was launched and did not answer in time. It may still be starting; the next call usually finds it.

## Deliver (headless)

`obsrv_report` is the artefact: a matrix of screens, full-page bands, audit and lint, one HTML page. It never drives the window — deliver it, do not narrate it. `obsrv_snap { fullPage: true }` for a whole-page raster; `obsrv_diff` for the 1x-vs-2x numbers. All headless by design.
````

Update the two existing bullets about `--full-page` / tabs in the skill so nothing still says an agent cannot open or switch tabs.

- [ ] **Step 4: README and tool descriptions**

`README.md`: replace the "Tabs are a first cut" bullet's last two sentences (`An agent can only reach the tab in front … at all.`) with: `An agent opens, fronts and closes tabs through `obsrv_drive` (`tab`, `closeTab`) and reads them from `tabs`.` Keep the reorder/drag limitations. In the live-drive section, replace the sentence that says the app must be open with control on: `The MCP tools launch the app when it is not running; if it is open with agent control off, the app asks — Allow for this session, or Not now.`

`src/mcp/server.ts`: append to the `obsrv_report` description: `Always headless: this is an artefact for delivery, not a live review — use obsrv_drive to review in the window.` The `obsrv_diff` description already says headless-only; leave it.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run --project unit tests/unit/plugin.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/obsrv-screens/SKILL.md README.md src/mcp/server.ts tests/unit/plugin.test.ts
git commit -m "docs: the skill teaches review-in-the-window and deliver-headless; tabs are an agent surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Measure the launch, then release

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-live-first-agent-drive-design.md` (§8, record the numbers)
- Modify: `src/mcp/lib.ts` (`LAUNCH_TIMEOUT_MS` if the measurement says so)

This task is manual by design: it spawns a real GUI. Run it once on this Mac (npm-Electron path; the DMG path when an `Obsrv.app` is installed).

- [ ] **Step 1: Cold start against the bound**

Quit every Obsrv. Then, from the repo (built), time the first live call:

```bash
node -e "
const t=Date.now();
const {ensureLive}=require('./out/mcp/control.js');
const {planLive}=require('./out/mcp/lib.js');
ensureLive(planLive('auto',[],[],process.env,process.platform)).then(r=>{console.log(JSON.stringify({path:r.path,why:r.why,launched:r.launched,ms:Date.now()-t}))})
"
```

Expected: `{"path":"live","launched":true,"ms":<N>}` with `N` well under 12000. Record `N` in spec §8.1. If `N` is over 8000 on an idle machine, raise `LAUNCH_TIMEOUT_MS` to `2 × N` rounded up to the second, and re-run the unit tests (the timeout note test derives from the constant).

- [ ] **Step 2: The environment reaches the app**

With the app the previous step launched still open: the toolbar shows the **AGENT** chip (control force-enabled) and Settings → Agent control reads on. Quit it, then check `~/Library/Application Support/Obsrv/control.json` is gone. Record in §8.2 which path launched (`bundle` or `electron`) — `resolveDefaultTarget()` printed via `node -e "console.log(require('./out/mcp/launch.js').resolveDefaultTarget())"`.

- [ ] **Step 3: Detachment**

Run Step 1's command again, then kill the node process with Ctrl-C the moment it prints. The app stays open. Record in §8.3.

- [ ] **Step 4: Stop mid-command leaves no port**

With the app open and control on: start `obsrv_drive { scroll: { page: "next" } }` in a loop from a second terminal (`for i in $(seq 1 30); do …; done` against `node bin/obsrv-mcp.js` via the SDK client from `tests/e2e/mcp-live.spec.ts`'s helper, or simply the raw HTTP `call` from `live-drive.spec.ts`), click the AGENT chip mid-loop. The loop's next call fails with `why: "declined"`; `lsof -iTCP -sTCP:LISTEN -P | grep -i obsrv` shows no listener; `control.json` is a disabled stance. Record in §8.5.

- [ ] **Step 5: Two binaries, one profile** (only if an `Obsrv.app` is installed)

Open the DMG app with control off. Run Step 1's command. The DMG app shows the consent bar (the npm Electron lost the lock and exited). Click Allow: the command prints `path: "live"`. Record in §8.4.

- [ ] **Step 6: Commit the measurements**

```bash
git add docs/superpowers/specs/2026-09-07-live-first-agent-drive-design.md src/mcp/lib.ts
git commit -m "docs: live-first launch measured — cold start, env, detachment, stop

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Full suite, then release**

```bash
npm run typecheck && npm test && npm run test:browser && npm run build && npx playwright test
```

Expected: all green (allow one `--retries=1` rerun for the ledgered flakes). Then the release procedure as recorded in memory: `npm version minor` (once) → `npm run plugin:branch` → `npm run release:pack` → verify the tarball manifest has `dependencies.electron` → push `main` → wait for main CI green → `git push origin plugin plugin-v<version> v<version>` → wait for the tag build (the `plugin-tag` job gates the DMGs) → `gh release edit` with notes that lead with: *the app launches when an agent needs it; the AGENT chip is the off switch; the app asks when it is open with control off.* The user runs `npm publish ./getobsrv-<version>.tgz`.

---

## Self-review

**Spec coverage.**
- §1 model, four reasons + launch-timeout → Task 3 (`planLive`), Task 5 (`declined`, `launch-timeout`), Tasks 6–7, 10 (`why` on every mode-bearing tool; drive errors with it).
- §2 file shape with `enabled` → Task 1; app writes it always, Stop → Task 2; 2a launch, resolution, env, detach, wait, `launched` → Tasks 4–6; 2c consent bar, copy, Allow/Not now, no stacking → Task 8; 2d stay declined → Task 5 (`declined` short-circuits, never launches).
- §3 tabs: commands, validation, `status.tabs`, drive `tab`/`closeTab`, order, last-tab refusal, `maxTabs` → Tasks 9–10.
- §4 `scroll.page`, `atEnd`, the skill's two paths → Tasks 11–12.
- §5 tool descriptions → Tasks 6, 7, 10, 12.
- §7 tests: unit tables (3, 4, 5, 9, 11), e2e under `OBSRV_TEST` (6–11), `consent.spec` (8), stubbed launch under harness (Task 4's guard + Task 3's table; Task 6 asserts `launched` undefined under the harness). Manual launch checklist → Task 13.
- §8 risks → Task 13 measures 1–5.
- Non-goals honoured: no Windows path (Task 4 refuses), no background driving (`tab` activates first, Task 10), report untouched (Task 12 only adds a sentence).

**Placeholder scan.** No TBD/TODO. Every code step shows code. Two places tell the implementer to *check* something rather than assert it — the compiled `__dirname` depth in Task 4, and whether the tab strip's new-tab handler does more than add+activate in Task 9 — both with the exact command or search to run.

**Type consistency.** `ControlFile`/`isDisabledStance` (T1) used by `discover` (T5). `HeadlessWhy`, `LivePlan`, `HeadlessPlan`, `LAUNCH_TIMEOUT_MS`, `DECLINED_NOTE` (T3) used by T5, T6, T7, T10. `LiveResolution.launched` (T5) used by T6/T7/T10. `ControlTab` and `ControlStatus.tabs` (T9) used by T10's output shape. `ScrollPage`/`atEnd` (T11) consistent across types, parsers, preload, server, drive. `hooks.secondInstance` (T8) called from `index.ts` and the consent spec's test hook. `IPC.settingsChanged` is conditional in T8 — the implementer adds it if absent; the ConsentBar updates the store locally either way, so the bar works without it.
