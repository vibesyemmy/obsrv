import { Deadline, walkTimeoutNote, withinBudget } from '../shared/measureBudget'
import type { TargetSource } from '../main/targetSource'
import type { Walked } from '../shared/types'
import { WALK_STEP_SCRIPT, type WalkStepResult } from '../shared/scrollHost'
import { walkDialogNote, walkHostNote, walkNothingNote, type WalkBlocked, type WalkHost } from '../shared/walkCoverage'

/**
 * Walking the page before measuring it, headlessly.
 *
 * A page measured as it first shows is not the page a user sees: images
 * behind a lazy loader are still their 1×1 placeholders, and sections that
 * mount on scroll do not exist. Measured on apple.com at 1080p-24: nineteen
 * "upscaled" findings headless, every one a placeholder GIF judged against a
 * 1250 px box; zero once the page had been walked in the live app, whose
 * audit and lint have walked first since 0.42.0. So the headless audit, lint
 * and report walk too — a screenful at a time to the end, a short dwell on
 * each so observers fire and loaders swap their sources, back to the top,
 * then a bounded wait for the images those swaps started.
 *
 * The step is the live `scroll { page }`'s arithmetic, run in the page
 * (`walkStep` in `src/shared/scrollHost.ts`); the loop and its limits are the live walk's
 * (`src/mcp/walk.ts`). Never throws: a walk must not fail the measurement it
 * precedes, so every failure is a note.
 */

/**
 * Pause on each screenful. No eye to please here, only observers and loaders:
 * an IntersectionObserver callback needs a frame, and a loader that polls the
 * scroll (lazysizes checks every 125 ms) needs a little more. Measured on
 * apple.com — see the branch's notes.
 */
export const HEADLESS_WALK_DWELL_MS = 150
/**
 * Wall-clock budget for the whole walk, top to top, and its only bound on
 * length: at 150 ms a screenful it covers a hundred before it runs out. A
 * screenful cap of twelve, borrowed from the band capture, left bbc.com's
 * lower ten screenfuls measured as they shipped — placeholders as upscaled
 * images, the 0.42.0 finding again (41 with the capped walk, 62 without).
 */
export const HEADLESS_WALK_BUDGET_MS = 15_000
/** How long to wait, after the walk, for the images it set loading. */
export const HEADLESS_WALK_IMAGES_MS = 2_000
const IMAGES_POLL_MS = 100

export interface HeadlessWalkOutcome {
  /** Absent when the walk did not run to a measurement — the notes say why. */
  walked?: Walked
  notes: string[]
  /**
   * The document hid its own overflow when the walk stopped: the shape a
   * modal's scroll lock makes. Kept out of `walked`, which is part of the
   * tools' output shape — a new key there breaks a session that listed them
   * before it existed. `walkCoverageNote` uses it to name the cause.
   */
  documentLocked?: boolean
  /** What blocked the page, when the walk found nothing to scroll (`walkNothingNote`). */
  blocked?: WalkBlocked
  /** The page's height at the walk's first step; the caller compares it with the height measured afterwards. */
  pageHeightAtStart?: number
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * `budgetMs` bounds the whole walk, the image settle included, and every
 * scroll asked of the page within it: a page whose main thread is blocked
 * (a bot challenge) never answers a scroll, and without the bound the walk
 * sat behind it as the measurement did (`shared/measureBudget`).
 */
export async function walkHeadless(target: TargetSource, budgetMs: number = HEADLESS_WALK_BUDGET_MS): Promise<HeadlessWalkOutcome> {
  const notes: string[] = []
  const started = Date.now()
  const deadline = new Deadline(budgetMs)
  // A page that replaced itself under the walk — HMR, an auth redirect, a
  // router — put a new document at the top. Subscribing to the commit is the
  // same event the measurement's own notes read (cli/main.ts); inferring one
  // from an offset that went backwards would be a second mechanism for one
  // fact. Live reads the arrivals count echoed on the scroll reply, which is
  // this event crossing a process boundary (mcp/walk.ts).
  let replaced = false
  // The reported time restarts with the count: both fields of `walked`
  // describe the document the figures are of. The budget keeps its own clock.
  let walkedFrom = started
  const onCommit = (_url: string, inPage: boolean): void => {
    if (!inPage) replaced = true
  }
  target.on('url-changed', onCommit)
  const step = async (page: 'top' | 'next'): Promise<WalkStepResult> => {
    // The time this step is actually given, captured before the call. The note
    // used to name `budgetMs`, the walk's whole budget, which is the wait a
    // step makes only when it is the first thing the walk does
    // (`bug-walk-return-note-names-budget`).
    const allowed = deadline.remaining()
    const r = await withinBudget(target.webContents.executeJavaScript(`${WALK_STEP_SCRIPT}(${JSON.stringify(page)})`), allowed)
    if (r.timedOut) throw new Error(walkTimeoutNote(allowed))
    return r.value as WalkStepResult
  }
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
  /**
   * Returns the page to the top for the measurement that follows, and says so
   * when it could not — which is nearly always the spent-budget case, since
   * this runs after the loop has used the deadline up.
   *
   * **Two sentences, because two different things happen**
   * (`bug-walk-return-note-names-budget`, measured on a fake target):
   *
   * - **The budget was already gone.** The page is still asked — the scroll is
   *   issued and, on a free main thread, lands a few milliseconds later — but
   *   nothing waits for the answer. The old sentence got all three facts wrong:
   *   it named a 15 s wait that never happened, blamed a main thread that had
   *   answered every step (97 of them, on run `35239464603`), and called the
   *   measurement one of where the walk stopped when the page reaches the top.
   *   So this one names the walk's budget as the cause, says the page was not
   *   waited for, and claims nothing about where the page ended up.
   * - **The budget had time left and the step still failed.** Then the page
   *   really did not answer within a wait that was really made, and the
   *   original sentence is true as written.
   *
   * Silence is not an option for either: a walk that could not return the page
   * would otherwise read exactly like one that did (Henry).
   */
  const backToTop = async (): Promise<void> => {
    const hadBudget = deadline.remaining() > 0
    try {
      await step('top')
    } catch (e) {
      notes.push(
        hadBudget
          ? `the walk could not return to the top afterwards (${message(e)}); measured where it stopped.`
          : 'the walk had no budget left to return to the top, so it asked the page and did not wait for the answer; the page may have scrolled to the top after the measurement began.',
      )
    }
  }

  try {
    await step('top')
  } catch (e) {
    notes.push(`the walk was cut short before it began (${message(e)}); measured without walking.`)
    return { notes }
  }

  let screenfuls = 0
  let atEnd = false
  let documentLocked = false
  let blocked: WalkBlocked | undefined
  let panelWalked = false
  let panelWasDialog = false
  let lastY: number | null = 0
  // The page's height at the walk's FIRST step. Compared against the height
  // the measurement reports afterwards, it says whether the page grew.
  // First-against-last is the wrong pair: grows-as-walked.html extends after
  // the walk's last step, so those two agree on a page that plainly grew.
  let heightAtStart: number | undefined
  /** What the walk scrolled, when it was a container rather than the document. */
  let host: WalkHost | undefined
  try {
    for (;;) {
      if (deadline.passed()) {
        notes.push(
          `the walk stopped after ${screenfuls} screenful${screenfuls === 1 ? '' : 's'} at its ${Math.round(budgetMs / 100) / 10} s budget without reaching the end of the page; the measurement covers the whole page regardless.`,
        )
        break
      }
      const r = await step('next')
      // The document under the walk was replaced: the screenfuls counted so
      // far are of a page that is gone, and the offset they ended at belongs
      // to it. Count the new one from zero and forget that offset — without
      // this the new document's first scroll can land exactly where the old
      // one had reached, which read as a page that would not move and ended
      // the walk with a locked-scroll sentence about a page that had simply
      // been replaced (measured 2026-09-13: one screenful, atEnd false).
      if (replaced) {
        replaced = false
        screenfuls = 0
        lastY = null
        walkedFrom = Date.now()
      }
      // The document's own overflow as the walk last saw it: what tells a
      // page that grew under the walk from one a modal held (walkCoverage).
      documentLocked = r.hidden === true
      if (typeof r.pageHeight === 'number' && heightAtStart === undefined) heightAtStart = r.pageHeight
      // The container this walk is scrolling, kept from the FIRST step that
      // reported one. A later step is a worse witness: `textOutsideHost` reads
      // what is on screen, and by the last step the walk has scrolled the page
      // out from under that reading.
      if (r.host !== undefined && host === undefined) host = r.host
      // The page is locked and the only scroller left is a dialog's panel:
      // whatever this walk covers belongs to the dialog, not the page.
      if (r.scroller === 'element' && r.hidden) {
        panelWalked = true
        if (r.dialog) panelWasDialog = true
      }
      // A `next` that lands where the page already was has no more page to
      // show — the end, whatever `atEnd` says — so a one-screen page is zero
      // screenfuls, not twelve dwells at offset 0.
      if (r.y === lastY) {
        if (r.atEnd) {
          atEnd = true
          // Nothing to scroll on a page that hides its overflow: the walk is
          // right to stop, and must not read like a one-screen page.
          if (screenfuls === 0 && r.scroller === 'root' && r.hidden) {
            blocked = r.blocked
            notes.push(walkNothingNote(r.blocked))
          }
        } else notes.push('the page stopped moving before the end of the walk (a locked scroll, or a page that scrolls by other means); measured from where it stood.')
        break
      }
      lastY = r.y
      screenfuls++
      await sleep(HEADLESS_WALK_DWELL_MS)
      if (r.atEnd) {
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
    target.off('url-changed', onCommit)
    await backToTop()
    return partial ? { walked: { screenfuls, atEnd: false, ms: Date.now() - walkedFrom }, notes } : { notes }
  }
  target.off('url-changed', onCommit)
  if (panelWalked) notes.push(walkDialogNote(screenfuls, panelWasDialog))
  await backToTop()
  await settleImages(target, deadline)
  // Last, because it qualifies the screenfuls the sentences above report: a
  // reader who has just been told how far the walk got needs to know what it
  // got that far through.
  const said = walkHostNote(host)
  if (said !== null) notes.push(said)
  return { walked: { screenfuls, atEnd, ms: Date.now() - walkedFrom }, notes, documentLocked, blocked, pageHeightAtStart: heightAtStart }
}

/**
 * The walk sets images loading; the lint reads their natural sizes. Waits for
 * every `<img>` on the page to finish (loaded or failed — `complete` is true
 * either way), up to a bound: a page that never stops adding images is not
 * this function's to wait for.
 */
async function settleImages(target: TargetSource, walk: Deadline): Promise<void> {
  const until = Math.min(Date.now() + HEADLESS_WALK_IMAGES_MS, walk.at)
  while (Date.now() < until) {
    let pending: number
    try {
      const r = await withinBudget(
        target.webContents.executeJavaScript('Array.from(document.images).filter(i => !i.complete).length'),
        until - Date.now(),
      )
      if (r.timedOut) return
      pending = r.value as number
    } catch {
      return
    }
    if (pending === 0) return
    await sleep(IMAGES_POLL_MS)
  }
}
