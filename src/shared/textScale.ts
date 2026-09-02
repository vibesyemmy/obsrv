/**
 * Text scale: the page rendered as a browser at 125 / 150 / 200 % zoom would
 * render it, which is also what a phone's larger-text accessibility setting
 * and a Windows panel at 150 % do to a layout. Reflow, not magnification —
 * the CSS viewport shrinks by the factor and every CSS pixel grows by it, so
 * a 16 px font at ×1.5 is 24 device pixels on a 1x screen and the columns
 * that no longer fit wrap or collapse exactly as they would for the user.
 *
 * Applied as device emulation on the target alone (see `TargetSource`):
 * Chromium's own zoom factor is per host across a session, so it would zoom
 * the native pane and every other tab on the same origin with it.
 */

/** The choices the toolbar offers; agents and the CLI may pass any value in range. */
export const TEXT_SCALES: readonly number[] = [1, 1.25, 1.5, 2]

export const DEFAULT_TEXT_SCALE = 1

/** Chromium offers 25 %–500 %; below ×0.5 nothing is legible and above ×4 nothing fits. */
export const MIN_TEXT_SCALE = 0.5
export const MAX_TEXT_SCALE = 4

export function isTextScale(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= MIN_TEXT_SCALE && v <= MAX_TEXT_SCALE
}

/**
 * Validates a text scale from an untrusted payload. Absent means the default
 * (a renderer or an agent older than the field asks for nothing); present and
 * out of range is refused rather than clamped, because a clamped ×10 would
 * silently render something nobody asked for.
 */
export function parseTextScale(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_TEXT_SCALE
  return isTextScale(raw) ? raw : null
}

/** `1.5` → `150%`; `1.333` → `133%`. */
export function formatTextScale(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
