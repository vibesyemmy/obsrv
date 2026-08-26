import type { UpdateState } from './types'

/**
 * Everything about the update check that can be decided without Electron:
 * version comparison, parsing the releases API body, the URL allowlist, the
 * daily throttle and the "last checked" wording. Pure node — no I/O, no
 * Electron — so it is unit-tested in tests/unit/update.test.ts.
 *
 * Main owns the single HTTP GET (`src/main/updateCheck.ts`) and the release
 * URL itself; see the update spec §9 for why that string never reaches the
 * renderer.
 */

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

/**
 * Has enough time passed? A stamp in the future counts as due, so a clock
 * moved backwards cannot lock the check out until the interval catches up.
 */
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
