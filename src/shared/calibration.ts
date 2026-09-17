import { MAX_VIEWPORT } from './presets'
import type { Orientation } from './types'

export interface HostDisplay {
  physicalWidth: number
  physicalHeight: number
  diagonalInches: number
  scaleFactor: number
}

export interface TargetScreen {
  /** CSS pixels; the physical raster is this x `deviceScaleFactor`. */
  width: number
  height: number
  diagonalInches: number
  /** Device pixels per CSS pixel; omitted means 1 (every 1x monitor preset). */
  deviceScaleFactor?: number
}

/**
 * The screen as it is actually being held. The **one** place the axes are
 * swapped: everything downstream — the viewport handed to `TargetSource`, the
 * clamp, the magnification, the footer — reads the rotated screen and needs no
 * orientation of its own.
 *
 * Rotation must not change the *magnitude* of the physical scale, and does not:
 * `ppi` is `hypot(w, h) / diagonalInches` and `hypot` is symmetric, so the
 * diagonal, the pixel count and the density are all orientation-independent.
 * A phone does not get physically larger by being turned sideways. The unit
 * test asserts it, because it is exactly the kind of thing that drifts.
 *
 * `'portrait'` is the preset as the table stores it; `'landscape'` is that
 * rotated a quarter turn. Every mobile preset — the case this feature exists
 * for — is stored portrait, so for those the names are literal. A monitor
 * preset is stored landscape-natural, so there the pair reads as
 * unrotated/rotated instead; the UI never repeats the flag back at the user,
 * it names the shape the dimensions actually have (`screenShape`), so nothing
 * on screen can contradict the pixels beside it.
 */
export function applyOrientation<T extends TargetScreen>(screen: T, orientation: Orientation): T {
  if (orientation !== 'landscape') return screen
  return { ...screen, width: screen.height, height: screen.width }
}

/**
 * The shape a pair of dimensions actually has, for anything the user reads. A
 * square screen counts as portrait — it has no landscape reading, and one of
 * the two words has to win.
 */
export function screenShape(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait'
}

export function ppi(width: number, height: number, diagonalInches: number): number {
  if (!(diagonalInches > 0)) throw new RangeError('diagonalInches must be > 0')
  return Math.hypot(width, height) / diagonalInches
}

/**
 * Physical host pixels per target *device* pixel. The target's PPI is a
 * device-pixel density: a 393x852 CSS phone at 3x packs 1179x2556 pixels into
 * its 6.1" diagonal, so each of them gets ~0.3 host pixels on a desktop
 * monitor — physically smaller than any 1x screen's pixel, which is the point.
 */
export function computeScale(host: HostDisplay, target: TargetScreen, pixelExact: boolean): number {
  if (pixelExact) return host.scaleFactor
  const dsf = target.deviceScaleFactor ?? 1
  return (
    ppi(host.physicalWidth, host.physicalHeight, host.diagonalInches) /
    ppi(target.width * dsf, target.height * dsf, target.diagonalInches)
  )
}

/**
 * The CSS-pixel budget for a surface rasterising at `deviceScaleFactor`:
 * `MAX_VIEWPORT` limits *device* pixels, so the CSS clamp shrinks with the
 * factor (393x852 at 3x is 1179x2556 device pixels and fits). A non-finite or
 * sub-1 factor counts as 1.
 */
export function maxCssViewport(deviceScaleFactor: number): number {
  const dsf = Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 1 ? deviceScaleFactor : 1
  return Math.max(1, Math.floor(MAX_VIEWPORT / dsf))
}

export function clampViewport(width: number, height: number, max = MAX_VIEWPORT): { width: number; height: number; clamped: boolean } {
  const finite = (v: number): number => (Number.isFinite(v) ? v : 1)
  const w = Math.min(max, Math.max(1, Math.floor(finite(width))))
  const h = Math.min(max, Math.max(1, Math.floor(finite(height))))
  return { width: w, height: h, clamped: w !== width || h !== height }
}

/**
 * Which of the two rotation flags the caller meant.
 *
 * `orientation` names the preset's **stored** form, so `'landscape'` means "the
 * rotated one" and produces a *portrait* screen on every preset stored
 * landscape — every monitor and laptop. The word inverts its plain meaning on
 * half the table, and it cost obsrv-e7 a mis-measured parity hunt on 2026-09-14
 * (`bug-orientation-name`).
 *
 * `rotate` says the thing itself and is the flag to use. `orientation` keeps
 * its meaning and is deprecated: changing what it means would trade a confusing
 * name for a silent wrong answer, which is the one outcome this project has
 * spent the week removing (Henry's call, option 3 of four).
 *
 * **A caller giving both, disagreeing, is refused rather than resolved.** There
 * is no reading of `{ orientation: 'landscape', rotate: false }` that is not a
 * guess about which half the caller meant, and guessing silently is how the
 * original defect cost a day.
 */
export function resolveRotate(
  orientation: Orientation | undefined,
  rotate: boolean | undefined,
): { rotate: boolean } | { refuse: string } {
  const fromWord = orientation === undefined ? undefined : orientation === 'landscape'
  if (fromWord !== undefined && rotate !== undefined && fromWord !== rotate) {
    return {
      refuse:
        `orientation: '${orientation}' and rotate: ${rotate} disagree. ` +
        `orientation names the preset's STORED form, so 'landscape' means rotated and 'portrait' means as-stored; ` +
        `rotate says it directly. Pass one — rotate is the one to keep.`,
    }
  }
  return { rotate: rotate ?? fromWord ?? false }
}

/**
 * The same equivalence as `resolveRotate`, read in each direction, for the two
 * places that hold a settled value rather than a caller's request.
 *
 * The control server speaks in the word — `setOrientation { orientation }`, and
 * `status` answers with it — while every MCP reply now also carries `rotated`,
 * which says the thing itself. These two translations are the join between
 * those, and they live here so no handler writes its own ternary: a word that
 * means two things is exactly what `bug-orientation-name` was.
 */
export function rotatedFromOrientation(orientation: Orientation): boolean {
  return orientation === 'landscape'
}

export function orientationFromRotate(rotate: boolean): Orientation {
  return rotate ? 'landscape' : 'portrait'
}

/**
 * A sentence for the reply **only when the word contradicts the screen it
 * produced**, and nothing otherwise.
 *
 * A phone asked for `'landscape'` gets a landscape screen: the word was true
 * there and a note would be noise. A monitor asked for `'landscape'` gets a
 * portrait screen, and that is the case worth a sentence — it is the one that
 * reads as a defect in the tool rather than a quirk of the flag.
 *
 * Returns `null` when `rotate` was used instead: there is no word to contradict.
 */
export function orientationWordNote(
  orientation: Orientation | undefined,
  finalWidth: number,
  finalHeight: number,
): string | null {
  if (orientation === undefined) return null
  const shape = screenShape(finalWidth, finalHeight)
  if (shape === orientation) return null
  return (
    `orientation: '${orientation}' produced a ${shape} screen (${finalWidth}x${finalHeight}). ` +
    `That flag names the preset's STORED form rather than the shape you get, so the word inverts on ` +
    `presets stored the other way round. Use rotate: ${orientation === 'landscape'} to say it directly; ` +
    `screenShape always reports what you actually got.`
  )
}
