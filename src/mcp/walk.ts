import type { Walked } from '../shared/types'
import { walkDialogNote, walkNothingNote, type WalkBlocked } from '../shared/walkCoverage'
import { ControlCallError } from './control'

export type { Walked }

/**
 * Walking the page before measuring it.
 *
 * A live audit or lint reads the DOM without moving the window, which is
 * correct and, to the person who installed a window in order to watch,
 * indistinguishable from nothing happening. So before it measures, the MCP
 * server scrolls the page a screenful at a time to the end, then back to the
 * top — orchestration over the app's own `scroll { page }` command (0.41.0),
 * so an older app is a note, not a failure. Measured on usekolo.app, which
 * reveals sections on scroll, the walk also changed what was measured: seven
 * targets and sixteen text elements a top-only audit never sees. See
 * docs/superpowers/specs/2026-09-08-walk-before-measuring-design.md.
 */

/**
 * Pause on each screenful, on top of the scroll's own confirmation, so an eye
 * can land on it. Measured: nine screenfuls in 2,843 ms on usekolo.app, the
 * dwell nearly the whole of it.
 */
export const WALK_DWELL_MS = 350
/**
 * Wall-clock budget for a whole walk, and its only bound on length. There
 * used to be a screenful cap too — twelve, the band capture's, where each
 * screenful is a render — and everything past it was measured as the page
 * first shipped: bbc.com on a phone is twenty-two screenfuls, and the lint
 * reported the lazy placeholders below the twelfth as upscaled images, the
 * 0.42.0 finding again. A walk costs a dwell, not a render; the budget is
 * enough. Checked between steps, so a pathological page's worst case is the
 * budget plus one scroll's 5 s apply timeout, which keeps a live audit (this
 * walk, then a 20 s audit call) inside the MCP SDK's 60 s client request
 * timeout. Typical cost is ~4 s (measured, spec §2). Past the budget the
 * walk stops, `atEnd` stays false, and a note says so.
 */
export const WALK_BUDGET_MS = 15_000
export const WALK_OLDER_APP_NOTE = 'the app predates page-wise scrolling (0.41.0); measured without walking.'

export interface WalkDeps {
  /** One control command against the live app; `controlCall` bound to its info in production. */
  call: (command: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface WalkOutcome {
  /** Absent when the walk did not run to a measurement — the notes say why. */
  walked?: Walked
  notes: string[]
  /**
   * The document hid its own overflow when the walk stopped — see
   * `HeadlessWalkOutcome.documentLocked`. Not part of `walked`, which the
   * tools' output shape pins.
   */
  documentLocked?: boolean
}

/**
 * `scroll { page: "top" }`, then `next` until `atEnd`, the cap, or a scroll
 * the page did not confirm; then `top` again. Never throws: a walk must not
 * fail the measurement it precedes, so every failure is a note.
 */
/**
 * What an app said blocked the page, when it said it in numbers. An app
 * older than the field sends nothing, and `walkNothingNote` then offers the
 * list rather than claiming two measurements nobody made.
 */
function blockedFrom(raw: unknown): WalkBlocked | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const f = r['frames']
  const hosts = r['shadowHosts']
  if (f === null || typeof f !== 'object' || typeof hosts !== 'number' || !Number.isFinite(hosts)) return undefined
  const fr = f as Record<string, unknown>
  const count = fr['count']
  const cover = fr['viewportCoverage']
  if (typeof count !== 'number' || !Number.isFinite(count) || typeof cover !== 'number' || !Number.isFinite(cover)) return undefined
  return {
    frames: { count: Math.max(0, Math.floor(count)), viewportCoverage: Math.min(1, Math.max(0, cover)) },
    shadowHosts: Math.max(0, Math.floor(hosts)),
  }
}

export async function walkPage(deps: WalkDeps): Promise<WalkOutcome> {
  const notes: string[] = []
  const started = deps.now()
  const scroll = (page: 'top' | 'next'): Promise<Record<string, unknown>> => deps.call('scroll', { page })
  const backToTop = async (): Promise<void> => {
    try {
      await scroll('top')
    } catch (e) {
      notes.push(`the walk could not return to the top afterwards (${message(e)}); measured where it stopped.`)
    }
  }

  try {
    await scroll('top')
  } catch (e) {
    if (isOlderApp(e)) return { notes: [WALK_OLDER_APP_NOTE] }
    notes.push(`the walk was cut short before it began (${message(e)}); measured without walking.`)
    return { notes }
  }

  let screenfuls = 0
  let atEnd = false
  // The offset the last scroll reached. A `next` that lands where the page
  // already was has no more page to show — the end, whatever `atEnd` says —
  // so a one-screen page is zero screenfuls, not twelve dwells at offset 0.
  let documentLocked = false
  let panelWalked = false
  let panelWasDialog = false
  let lastY: number | null = 0
  try {
    for (;;) {
      if (deps.now() - started >= WALK_BUDGET_MS) {
        notes.push(
          `the walk stopped after ${screenfuls} screenful${screenfuls === 1 ? '' : 's'} at its ${WALK_BUDGET_MS / 1000} s budget without reaching the end of the page; the measurement covers the whole page regardless.`,
        )
        break
      }
      const r = await scroll('next')
      // As the headless walk: the document's overflow when the walk stopped.
      documentLocked = r['hidden'] === true
      // The page is locked and the only scroller left is a dialog's panel:
      // the screenfuls below belong to the dialog, not the page. An app older
      // than the field sends nothing, and gets no sentence.
      // `panel` is the live measurement — an element scroller on a locked
      // document. `hidden` cannot stand in for it here: on this surface it
      // means *root* scroller plus a locked document, so the pair can never
      // both be true (src/preload/sync.ts). An app older than `panel` sends
      // only `dialog`, which is that same measurement narrowed to a named
      // role, so it still fires and simply cannot report the anonymous case.
      if (r['panel'] === true || r['dialog'] === true) {
        panelWalked = true
        if (r['dialog'] === true) panelWasDialog = true
      }
      const at = r['scrolled']
      if (at === null || at === undefined) {
        notes.push('the page did not confirm a scroll during the walk; the walk stopped there.')
        break
      }
      const y = typeof (at as { y?: unknown }).y === 'number' ? (at as { y: number }).y : null
      if (y !== null && y === lastY) {
        if (r['atEnd'] === true) {
          atEnd = true
          // Nothing to scroll on a page that hides its overflow (an app older
          // than the field says nothing, and gets no sentence).
          if (screenfuls === 0 && r['scroller'] === 'root' && r['hidden'] === true) notes.push(walkNothingNote(blockedFrom(r['blocked'])))
        } else notes.push('the page stopped moving before the end of the walk (a locked scroll: a modal or a menu holding the page, or a page that scrolls by other means); measured from where it stood.')
        break
      }
      lastY = y
      screenfuls++
      await deps.sleep(WALK_DWELL_MS)
      if (r['atEnd'] === true) {
        atEnd = true
        break
      }
    }
  } catch (e) {
    const partial = screenfuls > 0
    notes.push(
      `the walk was cut short after ${screenfuls} screenful${screenfuls === 1 ? '' : 's'} (${message(e)}); ` +
        (partial ? 'measured after a partial walk.' : 'measured without walking.'),
    )
    await backToTop()
    return partial ? { walked: { screenfuls, atEnd: false, ms: deps.now() - started }, notes } : { notes }
  }
  if (panelWalked) notes.push(walkDialogNote(screenfuls, panelWasDialog))
  await backToTop()
  return { walked: { screenfuls, atEnd, ms: deps.now() - started }, notes, documentLocked }
}

/** A 400 to `scroll { page }` is an app whose `parseScrollRequest` predates `page` (before 0.41.0). */
function isOlderApp(e: unknown): boolean {
  return e instanceof ControlCallError && e.statusCode === 400
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
