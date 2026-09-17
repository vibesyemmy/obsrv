import type { DisplayKey, HostInfo, Settings } from './types'

/**
 * Whether the monitor diagonal the magnification is computed from is known to
 * be this screen's, and what the target footer says when it is not
 * (`ux-first-launch-no-calibration`).
 *
 * `hostDiagonalInches` defaults to 27, and on a 13.3″ laptop that renders the
 * target at 49% of its physical size with nothing saying so. The hint is the
 * thing that says so. It stays quiet only when the diagonal was set for the
 * display the window is on, so its silence means one thing.
 *
 * `hostDiagonalSetFor` records WHICH display the diagonal was set for, not just
 * whether anyone set it. That one field answers both "untouched?" and "set for
 * a different screen?" (a laptop plugged into an external monitor). It is a
 * list from the start so that remembering a diagonal per display, if that is
 * ever chosen, changes the lookup and not the file format. Today it holds at
 * most one entry and no `inches`: `hostDiagonalInches` is the value.
 *
 * `'unknown'` is a diagonal someone set before this field existed: a non-default
 * value in an old `settings.json`. They calibrated, but nothing recorded for
 * which screen, and adopting it for whichever screen opens first would be
 * silent exactly when that guess is wrong (Henry's call, 2026-09-17).
 */

/** The most displays the field may carry: room for per-display diagonals later, and a bound on a hand-edited file. */
export const MAX_RECORDED_DISPLAYS = 8

export type DiagonalHint =
  | { kind: 'none' }
  /** Nobody has set the diagonal: the render assumes the default. */
  | { kind: 'untouched'; inches: number }
  /** Set before Obsrv recorded which screen it was for. */
  | { kind: 'unknown-screen'; inches: number }
  /** Set for a different display than the one the window is on. */
  | { kind: 'other-display'; inches: number; setFor: DisplayKey; current: DisplayKey }

const isWholePositive = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** One recorded display: whole physical pixels, and a diagonal only if one was given. */
export function isDisplayKey(v: unknown): v is DisplayKey {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  if (!isWholePositive(d.physicalWidth) || !isWholePositive(d.physicalHeight)) return false
  return d.inches === undefined || isPositive(d.inches)
}

/** The whole field, strictly: `'unknown'`, or up to `MAX_RECORDED_DISPLAYS` display keys. */
export function isDiagonalSetFor(v: unknown): v is Settings['hostDiagonalSetFor'] {
  return v === 'unknown' || (Array.isArray(v) && v.length <= MAX_RECORDED_DISPLAYS && v.every(isDisplayKey))
}

/** The display the window is on, or null while main has not said (all zeroes). */
export function displayKeyOf(host: HostInfo): DisplayKey | null {
  return host.physicalWidth > 0 && host.physicalHeight > 0 ? { physicalWidth: host.physicalWidth, physicalHeight: host.physicalHeight } : null
}

const sameDisplay = (a: DisplayKey, b: DisplayKey): boolean => a.physicalWidth === b.physicalWidth && a.physicalHeight === b.physicalHeight

export function diagonalHint(settings: Pick<Settings, 'hostDiagonalInches' | 'hostDiagonalSetFor'>, host: HostInfo): DiagonalHint {
  const current = displayKeyOf(host)
  // No display to compare against: the magnification is already the flat
  // fallback, and Settings says so ("Display information unavailable").
  if (current === null) return { kind: 'none' }
  const inches = settings.hostDiagonalInches
  const setFor = settings.hostDiagonalSetFor
  if (setFor === 'unknown') return { kind: 'unknown-screen', inches }
  if (setFor.length === 0) return { kind: 'untouched', inches }
  if (setFor.some(d => sameDisplay(d, current))) return { kind: 'none' }
  return { kind: 'other-display', inches, setFor: setFor[0]!, current }
}

/**
 * The settings with the diagonal recorded as set for the display the window is
 * on: what "Set size" commits and what the hint's confirmation commits. The
 * number is not touched. With no display known there is nothing to record, so
 * the field is left as it was rather than guessed.
 */
export function recordDiagonalFor(settings: Settings, host: HostInfo): Settings {
  const current = displayKeyOf(host)
  return current === null ? settings : { ...settings, hostDiagonalSetFor: [current] }
}

const formatInches = (inches: number): string => `${Math.round(inches * 10) / 10}″`
const formatDisplay = (d: DisplayKey): string => `${d.physicalWidth}×${d.physicalHeight}`

export interface DiagonalHintWords {
  message: string
  /** Records the current diagonal for this display, without changing it. */
  confirm: string
  /** Opens Settings on this display. */
  set: string
}

/** What the footer chip says. Each sentence names the screen size it is about, and none of them is a bare dismissal. */
export function diagonalHintWords(hint: Exclude<DiagonalHint, { kind: 'none' }>): DiagonalHintWords {
  const size = formatInches(hint.inches)
  switch (hint.kind) {
    case 'untouched':
      return {
        message: `this render assumes a ${size} screen, the default, so it is not at true physical size unless this screen is ${size}`,
        confirm: `${size} is right`,
        set: 'Set screen size',
      }
    case 'unknown-screen':
      return {
        message: `${size} was set before Obsrv recorded which screen it was for`,
        confirm: 'Right for this screen',
        set: 'Set screen size',
      }
    case 'other-display':
      return {
        message: `screen size was set on a ${formatDisplay(hint.setFor)} display; this one is ${formatDisplay(hint.current)}, so this render assumes ${size}`,
        confirm: `${size} is right here`,
        set: 'Set size for this screen',
      }
  }
}
