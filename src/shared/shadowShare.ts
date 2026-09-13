import type { ShadowContent } from './emptyDocument'

/**
 * The sentence for a page that hides part of itself behind shadow roots.
 *
 * `shadowContent` runs on every measurement, but until now its counts were
 * read only when the light DOM was **completely** empty — four call sites,
 * all inside a `stillEmpty` guard. So the rare case was covered and the
 * common one was not: a page with a dozen ordinary controls and forty more
 * inside components answered "12 targets, 12 findings, 0 warnings", which
 * reads as a complete measurement of a page it measured a quarter of
 * (measured on a fixture, run 15, 2026-09-12).
 *
 * The test that makes this a defect rather than a tool being quiet: name the
 * two facts that would each produce the silence. A page with no shadow roots
 * at all and a page hiding 40 of 52 controls produced the same output —
 * opposite facts, one silence.
 */

/**
 * Below this share, a root is a widget on a page rather than a page hiding
 * itself. Chosen by printing the sentence at every shape either side of it
 * — 1.9%, 3.8%, 7.7%, 15.4%, 23%, 50%, 77% — including the ones it
 * suppresses, so the floor was picked against real output and not against a
 * round number. At 7.7% (4 of 52) the reader's figures are materially right
 * and the sentence reports the presence of a component; at 15.4% (8 of 52)
 * one control in six could not be measured, which changes how the numbers
 * above it should be read. That is the line.
 */
export const SHADOW_SHARE_FLOOR = 0.15

/**
 * And below this many hidden, a share is arithmetic rather than a finding.
 * Printed: 2 of 4 is 50% and reads as a page half unmeasurable, when it is a
 * four-control page with one widget on it. The two conditions are ANDed, so
 * a small page needs a real number hidden and a large one a real share; 3 of
 * 6 clears both and should, because half of that page cannot be measured.
 */
export const SHADOW_HIDDEN_FLOOR = 3

/**
 * A share is the wrong measure on a large page, and the floor above was
 * chosen on pages of about fifty elements. Printed at 500: 60 hidden of 560
 * is 10.7% and was silent — sixty controls nobody measured and no word about
 * it. At 10 of 510 the sentence reads as trivia and at 30 of 530 it reports
 * a navigation bar's worth of controls that were not checked, so the count
 * carries where the share cannot. ORed with the share, not ANDed: a page is
 * worth a sentence when *either* a lot of it is hidden or a lot is.
 *
 * Found by obsrv-4f asking for the asymmetric shape to be printed rather
 * than defaulted — the shape they named (4 of 44) is correctly silent, and
 * printing it surfaced the one either side of it that was not.
 *
 * **Controls only.** A count means the same thing on every page when it
 * counts controls and nothing like it when it counts text: measured on four
 * live sites the same day, text elements per interactive element ran 1.15
 * (ikea.com), 1.19 (ft.com), 1.47 (gov.uk) and 5.75 (linear.app) — a spread
 * of five, so no single number is the same amount of page twice. Twenty-five
 * hidden text elements is a card on one page and a section on another; 25
 * hidden controls is a navigation on both. Lint keeps the share alone, which
 * scales by construction.
 *
 * **The 0.5% case is deliberate, not an oversight.** 25 hidden of 5025 fires
 * on the count alone, and that will look wrong to whoever reads this next:
 * half a percent of a page, reported. It is right. A reader with 5,000
 * controls has an application rather than a page, and 25 controls it could
 * not measure is a component of that application — a toolbar, a menu, a
 * table's row actions — not a rounding error. Raising the ceiling to make
 * the percentage look respectable would silence exactly the pages where the
 * share is least able to speak.
 */
export const SHADOW_HIDDEN_CEILING = 25

/**
 * What the measurement did not enter, when the page also gave it something
 * to measure. Returns null when the page hides nothing worth saying — no
 * roots, roots holding nothing, or a share small enough to be a widget — and
 * null when the light DOM is empty, because `emptyDocumentNote` says it
 * better there: it can say the page is *built* from components, which this
 * cannot.
 */
export function shadowShareNote(what: 'audit' | 'lint', shadow?: ShadowContent): string | null {
  if (shadow === undefined || shadow.hosts === 0) return null
  // Each command is told about the kind of thing it measures. The audit
  // measures controls, so a page hiding controls is its business; lint
  // measures text, edges and images, and a page hiding text is what it
  // misses. Reporting the interactive count to lint would be a number about
  // somebody else's rules.
  const kind = what === 'audit' ? 'interactive elements' : 'text elements'
  const hidden = what === 'audit' ? shadow.interactive : shadow.text
  const light = (what === 'audit' ? shadow.lightInteractive : shadow.lightText) ?? 0
  // A root holding none of them hides nothing this command would have
  // measured, whatever else it holds: a threshold in hosts would fire on a
  // page whose components are decoration.
  if (hidden < SHADOW_HIDDEN_FLOOR) return null
  // The empty-document case belongs to `emptyDocumentNote`, which says more:
  // that the page is *built* from components. Standing down on `light === 0`
  // was not the same test that note uses — it fires on the *measurement*
  // being empty, which a page can be while three invisible elements sit in
  // the DOM. On the web-components fixture both fired and disagreed about
  // whether the light DOM had text (the sweep, 2026-09-13). Now that both
  // counts are filtered to what a measurement would keep, `light === 0` and
  // "the measurement found nothing" are the same condition, and the two
  // notes cannot both fire.
  if (light === 0) return null
  const total = hidden + light
  // The absolute is the audit's: see SHADOW_HIDDEN_CEILING for why a count
  // of text elements is not a count of anything comparable across pages.
  const ceiling = what === 'audit' ? SHADOW_HIDDEN_CEILING : Number.POSITIVE_INFINITY
  if (hidden / total < SHADOW_SHARE_FLOOR && hidden < ceiling) return null
  const roots = shadow.hosts === 1 ? '1 shadow root' : `${shadow.hosts} shadow roots`
  const holdVerb = shadow.hosts === 1 ? 'holds' : 'hold'
  // The tail says what the figures are of and stops. Naming the light count
  // again — "the figures are of the 3 in the light DOM, and the 3 behind the
  // boundary" — put three counts in one sentence, and on a small page the
  // same number three times (printed at 3 of 6, run 15). The subtraction is
  // the reader's to do and they have both halves.
  // Not "the figures above": the note is above them in the CLI's stderr, a
  // sibling field in the JSON, and wherever a client puts it through the MCP.
  // A sentence that describes the reader's layout is guessing at it.
  return (
    `${roots} ${holdVerb} ${hidden} of this page's ${total} ${kind}, which the measurement does not enter: ` +
    `the figures are of the light DOM alone`
  )
}
