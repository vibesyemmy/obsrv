import type { CaptureOptions, UnsettledReason } from '../cli/capture'

/**
 * What a live raster capture says about a frame that did not settle.
 *
 * Kept out of `ipc.ts` so that it can be tested without Electron, through the
 * same `captureQuiescent` call a real capture makes. The e2e lever for
 * `uncovered` is a race (a preset cycle under the capture, whose rate moved
 * from 1 of 6 to 7 of 7 between heads), so the wording is owned here and the
 * e2e only has to show the wiring fires once.
 *
 * **`uncovered` carries the capture's own sentence**, the one the CLI prints.
 * It is the only one that says part of the PNG is transparent, and it names the
 * frame's size and the unpainted region. It used to fall through to the
 * painting sentence, which is about motion
 * (`bug-live-raster-uncovered-said-as-painting`).
 */
export interface RasterWarnings {
  /** Pass to `captureQuiescent`: keeps the sentence the capture warned with, by reason. */
  onWarn: NonNullable<CaptureOptions['onWarn']>
  /** The reply's sentence for this verdict, or none for a settled frame. */
  forVerdict: (settled: boolean, reason: UnsettledReason | undefined) => string[]
}

export const RASTER_ANIMATING_WARNING = 'the page keeps painting (animation or video); this is one frame of it'
/**
 * A capture that settled under a layout epoch its source could not confirm
 * (`bug-live-raster-text-scale-mid-capture`). Not part of `forVerdict`, which
 * answers only for captures that did NOT settle: this one did, and is told
 * about anyway, because `settled: true` in silence is the thing that card and
 * `release-gate.md`'s escape hatch both refuse.
 */
export const RASTER_SCALE_UNCONFIRMED_WARNING =
  'the text scale was not confirmed as applied before this frame settled, so it may show the layout from before ' +
  'the change; the paints did go quiet, so this is not a timeout — take it again if the scale matters'

export const RASTER_PAINTING_WARNING =
  'the page was still painting when the capture budget ran out; the PNG may show a transitional frame'

/** `blank` is worded as the live window capture words it, so the caller passes that sentence in. */
export function rasterWarnings(blankWarning: string): RasterWarnings {
  const said = new Map<UnsettledReason, string>()
  return {
    onWarn: (message, reason) => {
      said.set(reason, message)
    },
    forVerdict: (settled, reason) => {
      if (settled) return []
      switch (reason) {
        case 'animating':
          return [RASTER_ANIMATING_WARNING]
        case 'blank':
          return [blankWarning]
        case 'resizing': {
          // The capture's own sentence again, for the same reason `uncovered`
          // uses it: this one names the size in the PNG and the size it was
          // asked for, and a copy here would drift from it. The window
          // capture's resize wording is about a different measurement (a
          // viewport poll), so it is not reused.
          const own = said.get('resizing')
          return own === undefined ? [] : [own]
        }
        case 'uncovered': {
          // `captureQuiescent` warns on the line before it returns this reason,
          // and rasterWarnings.test.ts goes through that call. No fallback: the
          // painting sentence here is the defect this module exists to remove,
          // and a copy of the capture's sentence would drift from it.
          const own = said.get('uncovered')
          return own === undefined ? [] : [own]
        }
        case 'timeout':
        case 'loading':
        case undefined:
          return [RASTER_PAINTING_WARNING]
        default: {
          // A new reason does not compile until it is routed above.
          const unrouted: never = reason
          void unrouted
          return [RASTER_PAINTING_WARNING]
        }
      }
    },
  }
}
