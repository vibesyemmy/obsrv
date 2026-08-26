# Update check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app notices a newer GitHub release once a day and offers one click to the page that has it.

**Architecture:** All logic — version compare, response parsing, URL allowlist, throttle, relative time — is pure TS in `src/shared/update.ts` and unit-tested in node. Main owns the single bounded HTTP GET, the stored release URL (which never crosses IPC) and the push to the renderer. The renderer holds the state in the store and renders a toolbar affordance only when an update exists.

**Tech Stack:** Electron `net` (no new dependency), zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-update-check-design.md`

---

## File structure

```
src/shared/
  update.ts        UpdateState helpers: isNewer, readRelease, isReleaseUrl,
                   isCheckDue, formatAge, constants          [new, pure]
  types.ts         + UpdateStatus, UpdateState, Settings fields
  presets.ts       + DEFAULT_SETTINGS.updateCheck / lastUpdateCheck
  settings.ts      loadSettings/saveSettings carry the two new fields
  ipcPayloads.ts   parseSettings copies the two new fields
  ipc.ts           + getUpdate, checkUpdate, openRelease, updateStatus
  api.ts           + the four ObsrvApi members
src/main/
  updateCheck.ts   checkForUpdate(): one bounded net.request        [new]
  ipc.ts           boot check, stored URL, the three handlers
src/preload/
  app.ts           + the four API members
src/renderer/src/
  state/store.ts   + update: UpdateState | null, setUpdate
  components/Toolbar.tsx        + the affordance
  components/SettingsPanel.tsx  + the Version block
  styles.css       + .update-button, .version-block
tests/
  unit/update.test.ts      pure logic
  unit/settings.test.ts    + the two new fields
  unit/cliBundle.test.ts   the CLI/MCP bundles never reach the network  [new]
  e2e/update.spec.ts       the whole path over a loopback release server
.github/workflows/ci.yml   dmg job publishes a Release
README.md                  install section + the update note
```

---

### Task 1: Shared update logic

Everything decidable without Electron. Five small pure functions, one test file.

**Files:**
- Create: `src/shared/update.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/unit/update.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/update.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  CHECK_INTERVAL_MS,
  formatAge,
  isCheckDue,
  isNewer,
  isReleaseUrl,
  readRelease,
} from '../../src/shared/update'

const NOW = 1_700_000_000_000

function payload(tag: string, url = 'https://github.com/vibesyemmy/obsrv/releases/tag/' + tag): string {
  return JSON.stringify({ tag_name: tag, html_url: url, name: 'Obsrv ' + tag })
}

describe('isNewer', () => {
  it('compares numeric segments', () => {
    expect(isNewer('0.7.0', '0.6.0')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.6.1', '0.6.0')).toBe(true)
    expect(isNewer('0.6.0', '0.6.0')).toBe(false)
    expect(isNewer('0.5.9', '0.6.0')).toBe(false)
  })
  it('tolerates a v prefix on either side', () => {
    expect(isNewer('v0.7.0', '0.6.0')).toBe(true)
    expect(isNewer('v0.6.0', 'v0.6.0')).toBe(false)
  })
  it('treats a missing segment as zero', () => {
    expect(isNewer('1.2', '1.2.0')).toBe(false)
    expect(isNewer('1.2.1', '1.2')).toBe(true)
  })
  it('sorts a prerelease below the same version without one', () => {
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewer('1.0.0-rc.2', '0.9.0')).toBe(true)
  })
  it('returns false rather than throwing on garbage', () => {
    expect(isNewer('', '0.6.0')).toBe(false)
    expect(isNewer('not-a-version', '0.6.0')).toBe(false)
    expect(isNewer('0.7.0', '')).toBe(false)
  })
})

describe('readRelease', () => {
  it('reports an available update with the version and URL', () => {
    const out = readRelease(payload('v0.7.0'), '0.6.0', NOW)
    expect(out).toEqual({
      state: { status: 'available', current: '0.6.0', latest: '0.7.0', checkedAt: NOW },
      url: 'https://github.com/vibesyemmy/obsrv/releases/tag/v0.7.0',
    })
  })
  it('reports current when the release is not newer', () => {
    const out = readRelease(payload('v0.6.0'), '0.6.0', NOW)
    expect(out).toEqual({ state: { status: 'current', current: '0.6.0', checkedAt: NOW }, url: '' })
  })
  it('rejects a body that is not JSON', () => {
    expect(readRelease('<html>rate limited</html>', '0.6.0', NOW)).toBeNull()
  })
  it('rejects a body with no usable tag', () => {
    expect(readRelease(JSON.stringify({ name: 'x' }), '0.6.0', NOW)).toBeNull()
    expect(readRelease(JSON.stringify({ tag_name: 42 }), '0.6.0', NOW)).toBeNull()
  })
  it('rejects an update whose URL is not on the releases path', () => {
    expect(readRelease(payload('v0.7.0', 'https://evil.test/x'), '0.6.0', NOW)).toBeNull()
  })
})

describe('isReleaseUrl', () => {
  it('accepts the real release URLs', () => {
    expect(isReleaseUrl('https://github.com/vibesyemmy/obsrv/releases/tag/v0.7.0')).toBe(true)
    expect(isReleaseUrl('https://github.com/vibesyemmy/obsrv/releases/latest')).toBe(true)
  })
  it('refuses anything else', () => {
    expect(isReleaseUrl('http://github.com/vibesyemmy/obsrv/releases/tag/v1')).toBe(false)
    expect(isReleaseUrl('https://github.com.evil.test/vibesyemmy/obsrv/releases/x')).toBe(false)
    expect(isReleaseUrl('https://github.com/vibesyemmy/obsrv/issues/1')).toBe(false)
    expect(isReleaseUrl('https://github.com/someone/else/releases/tag/v1')).toBe(false)
    expect(isReleaseUrl('file:///etc/passwd')).toBe(false)
    expect(isReleaseUrl('not a url')).toBe(false)
  })
})

describe('isCheckDue', () => {
  it('is due when never checked', () => {
    expect(isCheckDue(0, NOW)).toBe(true)
  })
  it('is not due a minute after a check', () => {
    expect(isCheckDue(NOW - 60_000, NOW)).toBe(false)
  })
  it('is due once the interval has passed', () => {
    expect(isCheckDue(NOW - CHECK_INTERVAL_MS - 1, NOW)).toBe(true)
  })
  it('is due when the stamp is in the future, so a clock change cannot lock it out', () => {
    expect(isCheckDue(NOW + CHECK_INTERVAL_MS * 10, NOW)).toBe(true)
  })
})

describe('formatAge', () => {
  it('describes the gap in the largest sensible unit', () => {
    expect(formatAge(0, NOW)).toBe('never')
    expect(formatAge(NOW - 5_000, NOW)).toBe('just now')
    expect(formatAge(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(formatAge(NOW - 120_000, NOW)).toBe('2 minutes ago')
    expect(formatAge(NOW - 3_600_000, NOW)).toBe('1 hour ago')
    expect(formatAge(NOW - 7_200_000, NOW)).toBe('2 hours ago')
    expect(formatAge(NOW - 86_400_000, NOW)).toBe('1 day ago')
    expect(formatAge(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago')
  })
  it('reads a future stamp as just now rather than a negative age', () => {
    expect(formatAge(NOW + 60_000, NOW)).toBe('just now')
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run --project unit tests/unit/update.test.ts
```
Expected: FAIL — `Cannot find module '../../src/shared/update'`.

- [ ] **Step 3: Add the types**

Append to `src/shared/types.ts`:
```ts
export type UpdateStatus = 'current' | 'available' | 'error'

/**
 * What the renderer knows about updates. The release URL is deliberately not
 * here: main keeps it and opens it itself, so nothing the renderer holds can
 * become a string handed to the OS. See the update spec §9.
 */
export interface UpdateState {
  status: UpdateStatus
  /** The running app version. Always present, so Settings can show it before
   *  any check has completed. */
  current: string
  /** Release version without a leading `v`. Present only when available. */
  latest?: string
  /** Epoch ms of the last completed attempt, success or failure. 0 = never. */
  checkedAt: number
}
```

- [ ] **Step 4: Implement**

`src/shared/update.ts`:
```ts
import type { UpdateState } from './types'

export const RELEASES_API = 'https://api.github.com/repos/vibesyemmy/obsrv/releases/latest'
export const RELEASE_URL_PREFIX = 'https://github.com/vibesyemmy/obsrv/releases/'
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const CHECK_TIMEOUT_MS = 5_000

/** `1.2.3-rc.1` → { parts: [1,2,3], pre: true }. Null when unparseable. */
function parseVersion(raw: string): { parts: number[]; pre: boolean } | null {
  const trimmed = raw.trim().replace(/^v/i, '')
  if (trimmed === '') return null
  const [core = '', ...rest] = trimmed.split('-')
  const parts = core.split('.').map(Number)
  if (parts.length === 0 || parts.some(n => !Number.isInteger(n) || n < 0)) return null
  return { parts, pre: rest.length > 0 }
}

/**
 * Is `latest` a higher version than `current`? Missing segments count as zero,
 * so `1.2` and `1.2.0` are equal. A prerelease sorts below the same version
 * without one, so a hand-pushed `v1.0.0-rc.1` never offers itself as an
 * upgrade over a released `v1.0.0`.
 */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  const len = Math.max(a.parts.length, b.parts.length)
  for (let i = 0; i < len; i++) {
    const x = a.parts[i] ?? 0
    const y = b.parts[i] ?? 0
    if (x !== y) return x > y
  }
  return !a.pre && b.pre
}

/**
 * Is this a URL we are willing to hand to the OS? Checked on the parsed URL's
 * protocol, host and path rather than by string prefix, so a lookalike host
 * like `github.com.evil.test` cannot pass.
 */
export function isReleaseUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const allowed = new URL(RELEASE_URL_PREFIX)
  return (
    parsed.protocol === allowed.protocol &&
    parsed.host === allowed.host &&
    parsed.pathname.startsWith(allowed.pathname)
  )
}

/**
 * The GitHub `releases/latest` body → the state to show and the URL to open.
 * Null whenever the body cannot be trusted: unparseable, no tag, or a URL that
 * fails the allowlist. Callers turn null into `status: 'error'`.
 */
export function readRelease(
  body: string,
  current: string,
  now: number,
): { state: UpdateState; url: string } | null {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const { tag_name: tag, html_url: url } = raw as { tag_name?: unknown; html_url?: unknown }
  if (typeof tag !== 'string' || parseVersion(tag) === null) return null

  if (!isNewer(tag, current)) return { state: { status: 'current', current, checkedAt: now }, url: '' }
  if (typeof url !== 'string' || !isReleaseUrl(url)) return null
  return {
    state: { status: 'available', current, latest: tag.trim().replace(/^v/i, ''), checkedAt: now },
    url,
  }
}

/** Has enough time passed? A stamp in the future counts as due, so a clock
 *  moved backwards cannot lock the check out until the interval catches up. */
export function isCheckDue(lastUpdateCheck: number, now: number): boolean {
  if (!Number.isFinite(lastUpdateCheck) || lastUpdateCheck <= 0) return true
  if (lastUpdateCheck > now) return true
  return now - lastUpdateCheck >= CHECK_INTERVAL_MS
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`

/** The one place the Settings block's last-checked wording is decided. */
export function formatAge(checkedAt: number, now: number): string {
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return 'never'
  const age = now - checkedAt
  if (age < MINUTE) return 'just now'
  if (age < HOUR) return plural(Math.floor(age / MINUTE), 'minute')
  if (age < DAY) return plural(Math.floor(age / HOUR), 'hour')
  return plural(Math.floor(age / DAY), 'day')
}
```

- [ ] **Step 5: Run, expect pass**

```bash
npx vitest run --project unit tests/unit/update.test.ts
```
Expected: `18 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/update.ts src/shared/types.ts tests/unit/update.test.ts && git commit -m "feat(shared): version compare, release parsing and check throttle"
```

---

### Task 2: Settings carry the preference

Two fields through the four places settings are defined, loaded, validated and
sent. The important requirement is backward compatibility: a `settings.json`
written by 0.6.0 has neither key and must load fine.

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/presets.ts`, `src/shared/settings.ts`, `src/shared/ipcPayloads.ts`
- Test: `tests/unit/settings.test.ts`

- [ ] **Step 1: Failing test**

Append inside the existing top-level `describe` in `tests/unit/settings.test.ts`:
```ts
  it('defaults the update fields when an older file has neither key', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, agentControl: false }))
    expect(loadSettings(f)).toEqual({
      hostDiagonalInches: 27,
      hostNits: 500,
      agentControl: false,
      updateCheck: true,
      lastUpdateCheck: 0,
    })
  })

  it('keeps an explicit updateCheck: false and refuses a non-boolean', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, updateCheck: false }))
    expect(loadSettings(f).updateCheck).toBe(false)
    // Unlike agentControl, the safe default here is on, so only a literal
    // false turns it off; anything else falls back to the default.
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, updateCheck: 0 }))
    expect(loadSettings(f).updateCheck).toBe(true)
  })

  it('keeps a sane lastUpdateCheck and discards a bad one', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, lastUpdateCheck: 1700000000000 }))
    expect(loadSettings(f).lastUpdateCheck).toBe(1700000000000)
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, lastUpdateCheck: 'soon' }))
    expect(loadSettings(f).lastUpdateCheck).toBe(0)
  })
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run --project unit tests/unit/settings.test.ts
```
Expected: FAIL — the loaded object has no `updateCheck` key.

- [ ] **Step 3: Extend the Settings type**

In `src/shared/types.ts`, replace the `Settings` interface with:
```ts
export interface Settings {
  hostDiagonalInches: number
  hostNits: number
  /**
   * Whether the loopback agent-control server runs (spec §14 "Live drive").
   * Off by default: the toolbar toggle turns it on, and
   * `OBSRV_AGENT_CONTROL=1` force-enables it for the session at boot.
   */
  agentControl: boolean
  /**
   * Whether the app asks GitHub about newer releases once a day. On by
   * default — unlike `agentControl` this opens no port and accepts nothing;
   * it is a single unauthenticated GET carrying no identifiers.
   */
  updateCheck: boolean
  /** Epoch ms of the last completed check, success or failure. 0 = never. */
  lastUpdateCheck: number
}
```

- [ ] **Step 4: Extend the defaults**

In `src/shared/presets.ts`, replace the `DEFAULT_SETTINGS` line with:
```ts
export const DEFAULT_SETTINGS: Settings = {
  hostDiagonalInches: 27,
  hostNits: 500,
  agentControl: false,
  updateCheck: true,
  lastUpdateCheck: 0,
}
```

- [ ] **Step 5: Load and save the new fields**

In `src/shared/settings.ts`, replace `loadSettings` and `saveSettings` with:
```ts
const isStamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function loadSettings(file: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    return {
      hostDiagonalInches: isPositive(raw.hostDiagonalInches) ? raw.hostDiagonalInches : DEFAULT_SETTINGS.hostDiagonalInches,
      hostNits: isPositive(raw.hostNits) ? raw.hostNits : DEFAULT_SETTINGS.hostNits,
      // Anything but a literal true (older files have no key at all) means off:
      // a network-facing capability must never be enabled by a malformed file.
      agentControl: raw.agentControl === true,
      // The opposite default: only a literal false turns the update check off,
      // so a file from before this feature keeps it on.
      updateCheck: raw.updateCheck !== false,
      lastUpdateCheck: isStamp(raw.lastUpdateCheck) ? raw.lastUpdateCheck : 0,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(file: string, s: Settings): void {
  if (!isPositive(s.hostDiagonalInches) || !isPositive(s.hostNits)) throw new RangeError('settings values must be finite and > 0')
  if (typeof s.agentControl !== 'boolean') throw new RangeError('agentControl must be a boolean')
  if (typeof s.updateCheck !== 'boolean') throw new RangeError('updateCheck must be a boolean')
  if (!isStamp(s.lastUpdateCheck)) throw new RangeError('lastUpdateCheck must be a finite epoch ms >= 0')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}
```

- [ ] **Step 6: Carry them across IPC**

In `src/shared/ipcPayloads.ts`, replace `parseSettings` (and the comment above
it) with:
```ts
/**
 * Copies exactly the five known keys; the numbers must be finite and
 * positive. A missing `agentControl` means false and a missing `updateCheck`
 * means true (the pre-feature wire shapes); any non-boolean value is refused,
 * never coerced.
 */
export function parseSettings(raw: unknown): Settings | null {
  if (!isRecord(raw)) return null
  const { hostDiagonalInches, hostNits } = raw
  if (!isFiniteNumber(hostDiagonalInches) || hostDiagonalInches <= 0) return null
  if (!isFiniteNumber(hostNits) || hostNits <= 0) return null
  const agentControl = raw.agentControl ?? false
  if (typeof agentControl !== 'boolean') return null
  const updateCheck = raw.updateCheck ?? true
  if (typeof updateCheck !== 'boolean') return null
  const lastUpdateCheck = raw.lastUpdateCheck ?? 0
  if (!isFiniteNumber(lastUpdateCheck) || lastUpdateCheck < 0) return null
  return { hostDiagonalInches, hostNits, agentControl, updateCheck, lastUpdateCheck }
}
```

- [ ] **Step 7: Run, expect pass**

```bash
npm run typecheck && npm test
```
Expected: typecheck silent; every unit file passes. Any other test that builds
a `Settings` literal now fails to typecheck — add `updateCheck: true` and
`lastUpdateCheck: 0` to each, which is the intended fallout of widening the type.

- [ ] **Step 8: Commit**

```bash
git add src/shared tests/unit/settings.test.ts && git commit -m "feat(shared): persist the update-check preference"
```

---

### Task 3: Main checks, and the renderer can read the answer

The HTTP call, the stored URL, the three IPC handlers and the store field. No
visible UI yet — the e2e drives it through `window.obsrv` against a loopback
release server, so nothing in the test suite touches the network.

`getUpdate()` is not test scaffolding: without it a renderer reload (Cmd+R, dev
HMR) would lose the state until the next daily check.

**Files:**
- Create: `src/main/updateCheck.ts`
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/app.ts`, `src/main/ipc.ts`, `src/renderer/src/state/store.ts`
- Test: `tests/e2e/update.spec.ts`

- [ ] **Step 1: Failing E2E spec**

`tests/e2e/update.spec.ts`:
```ts
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, rendererWindow } from './launch'

/**
 * The update path end to end against a loopback stand-in for the GitHub
 * releases API, pointed at by OBSRV_RELEASES_API. No test touches the network.
 */

let app: ElectronApplication
let page: Page
let server: Server

/** Swapped per test; the server answers with whatever is here. */
let reply = { code: 200, body: '' }

const release = (tag: string): string =>
  JSON.stringify({ tag_name: tag, html_url: `https://github.com/vibesyemmy/obsrv/releases/tag/${tag}` })

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(reply.code, { 'content-type': 'application/json' })
    res.end(reply.body)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo

  // A far-future stamp would suppress the boot check; 0 lets it run, and the
  // first test asserts what it produced.
  reply = { code: 200, body: release('v99.0.0') }
  app = await launchApp([], { OBSRV_RELEASES_API: `http://127.0.0.1:${port}/latest` })
  page = await rendererWindow(app)
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>(r => server.close(() => r()))
})

const check = (): Promise<Record<string, unknown>> =>
  page.evaluate(() => window.obsrv.checkUpdate() as Promise<Record<string, unknown>>)

test('the boot check reports the newer release', async () => {
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getUpdate()), { timeout: 10_000 })
    .toMatchObject({ status: 'available', latest: '99.0.0' })
})

test('a release that is not newer reads as current', async () => {
  reply = { code: 200, body: release('v0.0.1') }
  expect(await check()).toMatchObject({ status: 'current' })
  expect(await page.evaluate(() => window.obsrv.getUpdate())).toMatchObject({ status: 'current' })
})

test('an HTTP failure reads as error, never as an update', async () => {
  reply = { code: 403, body: '{"message":"API rate limit exceeded"}' }
  expect(await check()).toMatchObject({ status: 'error' })
})

test('a malformed body reads as error', async () => {
  reply = { code: 200, body: '<html>not json</html>' }
  expect(await check()).toMatchObject({ status: 'error' })
})

test('a release URL on another host is refused rather than offered', async () => {
  reply = {
    code: 200,
    body: JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com.evil.test/x' }),
  }
  expect(await check()).toMatchObject({ status: 'error' })
})

test('openRelease does nothing when main holds no validated URL', async () => {
  // The last check errored, so nothing is stored. This must be a quiet no-op:
  // the renderer never supplies the URL, so there is nothing else it could open.
  expect(await page.evaluate(() => window.obsrv.openRelease())).toBe(false)
})

test('every check stamps the settings, so an offline app retries daily not hourly', async () => {
  const before = (await page.evaluate(() => window.obsrv.getSettings())) as { lastUpdateCheck: number }
  expect(before.lastUpdateCheck).toBeGreaterThan(0)
})

test('the state survives a renderer reload', async () => {
  reply = { code: 200, body: release('v99.0.0') }
  await check()
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getUpdate()), { timeout: 10_000 })
    .toMatchObject({ status: 'available', latest: '99.0.0' })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
npm run test:e2e
```
Expected: the existing suite still passes; all eight new tests fail with
`window.obsrv.checkUpdate is not a function` / `...getUpdate is not a function`.

- [ ] **Step 3: The HTTP call**

`src/main/updateCheck.ts`:
```ts
import { net } from 'electron'
import { CHECK_TIMEOUT_MS, RELEASES_API, readRelease } from '../shared/update'
import type { UpdateState } from '../shared/types'

/**
 * One bounded GET against the releases API. Never throws and never retries:
 * every failure — offline, timeout, non-200, unparseable, a URL that fails the
 * allowlist — collapses to `status: 'error'`, which the toolbar ignores.
 *
 * `OBSRV_RELEASES_API` overrides the endpoint. The e2e suite points it at a
 * loopback server so no test touches the network; it is also the seam for a
 * fork that publishes elsewhere.
 */
export async function checkForUpdate(current: string, now: number): Promise<{ state: UpdateState; url: string }> {
  const failed = { state: { status: 'error', current, checkedAt: now } as UpdateState, url: '' }
  const endpoint = process.env.OBSRV_RELEASES_API ?? RELEASES_API

  return new Promise(resolve => {
    let settled = false
    const done = (v: { state: UpdateState; url: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }

    const request = net.request({ method: 'GET', url: endpoint })
    const timer = setTimeout(() => {
      request.abort()
      done(failed)
    }, CHECK_TIMEOUT_MS)

    // GitHub wants a UA and answers v3 JSON; neither carries an identifier.
    request.setHeader('accept', 'application/vnd.github+json')
    request.setHeader('user-agent', 'obsrv-update-check')

    request.on('response', response => {
      if (response.statusCode !== 200) {
        response.on('data', () => undefined)
        response.on('end', () => done(failed))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', c => chunks.push(Buffer.from(c)))
      response.on('end', () => {
        const parsed = readRelease(Buffer.concat(chunks).toString('utf8'), current, now)
        done(parsed ?? failed)
      })
      response.on('error', () => done(failed))
    })
    request.on('error', () => done(failed))
    request.on('abort', () => done(failed))
    request.end()
  })
}
```

- [ ] **Step 4: Channels and API surface**

In `src/shared/ipc.ts`, add four entries to the `IPC` object:
```ts
  getUpdate: 'obsrv:get-update',
  checkUpdate: 'obsrv:check-update',
  openRelease: 'obsrv:open-release',
  updateStatus: 'obsrv:update-status',
```

In `src/shared/api.ts`, add `UpdateState` to the type import from `./types` and
these four members to `ObsrvApi`:
```ts
  /** The current state. Seeded with the running version before any check. */
  getUpdate(): Promise<UpdateState>
  /** Check now, ignoring the daily throttle. Resolves with the new state. */
  checkUpdate(): Promise<UpdateState>
  /**
   * Open the release page. Takes no URL by design: main opens the string it
   * validated itself, so the renderer cannot ask the OS to open anything.
   * Resolves false when there is no stored URL to open.
   */
  openRelease(): Promise<boolean>
  onUpdateStatus(cb: (s: UpdateState) => void): () => void
```

In `src/preload/app.ts`, add `UpdateState` to the type import from
`../shared/types` and these four entries to the `api` object:
```ts
  getUpdate: () => ipcRenderer.invoke(IPC.getUpdate),
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate),
  openRelease: () => ipcRenderer.invoke(IPC.openRelease),
  onUpdateStatus: cb => subscribe<UpdateState>(IPC.updateStatus, cb),
```

- [ ] **Step 5: Wire it in main**

In `src/main/ipc.ts`, add to the imports:
```ts
import { shell } from 'electron'
import { isCheckDue, isReleaseUrl } from '../shared/update'
import type { UpdateState } from '../shared/types'
import { checkForUpdate } from './updateCheck'
```
(`shell` joins the existing `electron` import if one is already there.)

Then, immediately after the `appVersion` block, add:
```ts
  // --- update check ---------------------------------------------------------
  // The release URL lives here and only here; `openRelease` takes no argument,
  // so the renderer can never hand the OS a string of its own.
  // Seeded, not null: Settings shows the running version from the first paint,
  // and `checkedAt: 0` reads as "never" until a check completes.
  let update: UpdateState = { status: 'current', current: appVersion, checkedAt: 0 }
  let releaseUrl = ''

  const runUpdateCheck = async (): Promise<UpdateState> => {
    const now = Date.now()
    const { state, url } = await checkForUpdate(appVersion, now)
    update = state
    releaseUrl = state.status === 'available' && isReleaseUrl(url) ? url : ''
    // Stamped on failures too, so an offline machine retries once a day
    // rather than on every launch.
    const next = { ...settings, lastUpdateCheck: now }
    try {
      saveSettings(settingsFile, next)
      settings = next
    } catch {
      // A read-only settings file must not break the app; the check simply
      // repeats next launch.
    }
    if (!win.isDestroyed()) win.webContents.send(IPC.updateStatus, state)
    return state
  }

  ipcMain.handle(IPC.getUpdate, e => {
    assertRenderer(e)
    return update
  })
  ipcMain.handle(IPC.checkUpdate, e => {
    assertRenderer(e)
    return runUpdateCheck()
  })
  ipcMain.handle(IPC.openRelease, async e => {
    assertRenderer(e)
    if (releaseUrl === '') return false
    await shell.openExternal(releaseUrl)
    return true
  })

  // Fired after the window exists and never awaited, so a hung network cannot
  // delay the first paint.
  if (settings.updateCheck && isCheckDue(settings.lastUpdateCheck, Date.now())) {
    void runUpdateCheck()
  }
```

- [ ] **Step 6: Hold it in the store**

In `src/renderer/src/state/store.ts`, add `UpdateState` to the type import from
`../../../shared/types`, then add the field to `AppState` beside the other
nullable state:
```ts
  update: UpdateState | null
```
its setter to the action list:
```ts
  setUpdate(u: UpdateState | null): void
```
its initial value beside the other nulls:
```ts
  update: null,
```
and the setter beside the others:
```ts
  setUpdate: update => set({ update }),
```

In `src/renderer/src/App.tsx`, add `setUpdate` to the destructured store
actions:
```tsx
  const setUpdate = useStore(s => s.setUpdate)
```
add a `getUpdate` read and an `onUpdateStatus` subscription to the existing
mount effect — the `void window.obsrv.getUpdate()` line beside the other reads,
and the subscription in the `offs` array:
```tsx
    void window.obsrv.getUpdate().then(setUpdate)
```
```tsx
      window.obsrv.onUpdateStatus(setUpdate),
```
and `setUpdate` to that effect's dependency array.

- [ ] **Step 7: Run, expect pass**

```bash
npm run typecheck && npm run test:e2e
```
Expected: typecheck silent; the existing suite plus `8 passed` in
`update.spec.ts`.

If the boot-check test times out, the check never ran: confirm
`settings.updateCheck` is true in the test's fresh user-data dir and that
`OBSRV_RELEASES_API` reached the app (`launchApp`'s second argument is env).

- [ ] **Step 8: Commit**

```bash
git add src/main src/preload src/shared src/renderer tests/e2e/update.spec.ts && git commit -m "feat(main): daily update check with a renderer-readable result"
```

---

### Task 4: The toolbar affordance and the Settings block

The only visible change. Per the UI style spec an update is neither a warning
nor an error, so it carries **no colour**: `--text-0` on `--chrome-2`, the
version in the mono face, the same 1px border every other toolbar control wears.

**Files:**
- Modify: `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/components/SettingsPanel.tsx`, `src/renderer/src/styles.css`
- Test: `tests/e2e/update.spec.ts`

- [ ] **Step 1: Failing test**

Append to `tests/e2e/update.spec.ts`:
```ts
test('the toolbar offers the update only when there is one', async () => {
  reply = { code: 200, body: release('v99.0.0') }
  await check()
  await expect(page.locator('.update-button')).toHaveText('v99.0.0 ↓')

  reply = { code: 200, body: release('v0.0.1') }
  await check()
  await expect(page.locator('.update-button')).toHaveCount(0)

  reply = { code: 500, body: '' }
  await check()
  // An error must never reach the toolbar.
  await expect(page.locator('.update-button')).toHaveCount(0)
})

test('the Settings block reports every state', async () => {
  await page.click('.toggle-settings')

  reply = { code: 200, body: release('v99.0.0') }
  await check()
  await expect(page.locator('.version-block')).toContainText('99.0.0')
  await expect(page.locator('.version-latest')).toContainText('Download')

  reply = { code: 200, body: release('v0.0.1') }
  await check()
  await expect(page.locator('.version-latest')).toHaveText('Up to date')

  reply = { code: 500, body: '' }
  await check()
  await expect(page.locator('.version-latest')).toHaveText('Couldn’t check')
  await expect(page.locator('.version-checked')).not.toHaveText('never')
})

test('the automatic-check toggle round-trips through main', async () => {
  await page.uncheck('.update-check-toggle input')
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getSettings()))
    .toMatchObject({ updateCheck: false })

  await page.reload()
  await expect(page.locator('.toggle-settings')).toBeVisible()
  await page.click('.toggle-settings')
  await expect(page.locator('.update-check-toggle input')).not.toBeChecked()

  await page.check('.update-check-toggle input')
  await expect
    .poll(() => page.evaluate(() => window.obsrv.getSettings()))
    .toMatchObject({ updateCheck: true })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
npm run test:e2e
```
Expected: the three new tests fail — `.update-button` never appears.

- [ ] **Step 3: The toolbar button**

In `src/renderer/src/components/Toolbar.tsx`, add to the store reads beside the
others:
```tsx
  const update = useStore(s => s.update)
```
and insert this immediately **before** the `<div className="surround-control" …>`
block:
```tsx
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
```

- [ ] **Step 4: The Settings block**

In `src/renderer/src/components/SettingsPanel.tsx`, add to the imports:
```tsx
import { formatAge } from '../../../shared/update'
```
add this store read beside the existing ones:
```tsx
  const update = useStore(s => s.update)
```

Then add this block at the end of the panel's returned tree, immediately before
its closing `</div>`:
```tsx
      <h2>Updates</h2>

      <div className="version-block">
        <div className="version-row">
          <span>Version</span>
          <span className="version-current num">{update?.current ?? '—'}</span>
        </div>
        <div className="version-row">
          <span>Latest</span>
          <span className="version-latest">
            {update === null && 'Not checked yet'}
            {update?.status === 'current' && update.checkedAt === 0 && 'Not checked yet'}
            {update?.status === 'current' && update.checkedAt > 0 && 'Up to date'}
            {update?.status === 'error' && 'Couldn’t check'}
            {update?.status === 'available' && update.latest !== undefined && (
              <>
                <span className="num">{update.latest}</span>
                {' · '}
                <button type="button" className="link" onClick={() => void window.obsrv.openRelease()}>
                  Download
                </button>
              </>
            )}
          </span>
        </div>
        <div className="version-row">
          <span>Last checked</span>
          <span className="version-checked num">
            {update === null ? 'never' : formatAge(update.checkedAt, Date.now())}
          </span>
        </div>
      </div>

      <label className="control inline update-check-toggle">
        <input
          type="checkbox"
          checked={settings.updateCheck}
          onChange={e => void commit({ ...settings, updateCheck: e.target.checked })}
        />
        <span>Check for updates automatically</span>
      </label>

      <button type="button" className="check-now" onClick={() => void window.obsrv.checkUpdate()}>
        Check now
      </button>

      <p className="muted">
        One unauthenticated request to GitHub, at most once a day. No identifiers are sent.
      </p>
```

- [ ] **Step 5: Styles**

Append to `src/renderer/src/styles.css`:
```css
/* An update is neither a warning nor an error, so it carries no colour: the
   only chromatic pixels in this chrome stay reserved for real attention. */
.update-button {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  width: auto;
  padding: 0 8px;
}
.version-block { margin: 8px 0; }
.version-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
  color: var(--text-1);
}
.version-row .version-current,
.version-row .version-latest,
.version-row .version-checked {
  color: var(--text-0);
  text-align: right;
}
.link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--text-0);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
.check-now {
  width: 100%;
  height: 24px;
  margin-top: 8px;
  background: var(--chrome-2);
  color: var(--text-0);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
}
```

- [ ] **Step 6: Run, expect pass**

```bash
npm run typecheck && npm run test:e2e
```
Expected: typecheck silent; `11 passed` in `update.spec.ts` and the rest of the
suite unchanged.

- [ ] **Step 7: Eyeball it**

```bash
npm run dev
```

Open Settings. With no release newer than the running version the block reads
"Up to date" and the toolbar is unchanged. Turn the toggle off, quit, relaunch,
reopen Settings: it is still off and no request was made.

- [ ] **Step 8: Commit**

```bash
git add src/renderer tests/e2e/update.spec.ts && git commit -m "feat(renderer): offer the update in the toolbar and settings"
```

---

### Task 5: Publish real releases, and prove the headless paths stay offline

The toolbar button opens a Releases page that does not exist yet: CI uploads
30-day artefacts, and README already promises otherwise.

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`
- Test: `tests/unit/cliBundle.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/cliBundle.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A structural guard, not a behavioural one: the headless CLI and the MCP
 * server must not be able to reach the releases API at all. The MCP server
 * speaks a stdio protocol where a stray byte on stdout is a bug, and a CI
 * render has no business calling GitHub.
 */
const ROOT = resolve(__dirname, '../..')

const BUNDLES = ['out/cli/main.js', 'out/mcp/server.js']

describe('headless bundles', () => {
  for (const rel of BUNDLES) {
    it(`${rel} contains no update-check code`, () => {
      const path = resolve(ROOT, rel)
      // Guard rather than skip: a renamed output would otherwise pass silently.
      expect(existsSync(path), `${rel} missing — run npm run build first`).toBe(true)
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain('api.github.com')
      expect(source).not.toContain('OBSRV_RELEASES_API')
    })
  }
})
```

- [ ] **Step 2: Run, expect pass or a real failure**

```bash
npm run build && npx vitest run --project unit tests/unit/cliBundle.test.ts
```
Expected: `2 passed`. This test guards existing structure rather than driving
new code — the CLI and MCP entry points never import `main/ipc.ts`. A failure
here is a real defect: something in the headless path now pulls in the update
check, and the fix is to break that import, not to relax the test.

If a bundle path does not exist, check the actual output names under `out/` and
correct `BUNDLES` — the assertion depends on naming the real files.

- [ ] **Step 3: Publish releases from CI**

In `.github/workflows/ci.yml`, replace the whole `dmg` job with:
```yaml
  release:
    name: Publish DMGs to a GitHub Release
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: macos-14
    timeout-minutes: 30
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc   # same toolchain the repo develops on
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build DMGs (unsigned)
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: npm run dist

      # The app's update check reads this release's tag, so the tag is the
      # version users are offered. Blockmaps are useless to the check-only
      # client and are attached because electron-updater wants them if
      # signing ever lands.
      - name: Publish the release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/*.dmg
            dist/*.blockmap
          fail_on_unmatched_files: true
          generate_release_notes: true
```

- [ ] **Step 4: Document it**

In `README.md`, append to the "Install (desktop app)" section, after the
`xattr -cr` block:
```markdown
Obsrv checks GitHub for a newer release once a day and, when there is one,
shows it in the toolbar; clicking opens the release page. It is a single
unauthenticated request carrying no identifiers, and Settings → Updates turns
it off.
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm test && npm run test:browser && npm run test:e2e
```
Expected: typecheck silent; all four suites green.

The release job only runs on a `v*` tag, so it cannot be exercised on this
branch. Verify it on the first tag after merge: the run should produce a
Release with two DMGs and two blockmaps attached, and
`https://github.com/vibesyemmy/obsrv/releases/latest` should resolve to it.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml README.md tests/unit/cliBundle.test.ts && git commit -m "ci: publish DMGs to a GitHub Release on tags"
```

---

## Notes for the implementer

- **Do not add `electron-updater`.** Nothing here downloads or installs; the
  app opens a page. Auto-update is gated on code signing (spec §10).
- **The release URL must never gain a path through IPC.** If a later change
  seems to need one in the renderer, that is the wrong shape — main opens it.
- **Task 2 widens `Settings`.** Every existing test that builds a `Settings`
  literal will fail to typecheck until it gains the two new fields. That is the
  intended blast radius, not a problem to work around with a cast.
