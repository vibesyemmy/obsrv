/**
 * What a measurement says when the checks refused some of what the page
 * sent.
 *
 * The parsers used to drop a whole report over one bad value — on
 * reuters.com a single srcset descriptor cost a page its 365 text elements
 * and 49 images (0.54.0). An entry that fails its checks now costs itself,
 * which is the right unit; the price is that a systematic fault — a producer
 * and a validator disagreeing about what can arrive, which is exactly what
 * that bug was — would otherwise show up as a page that merely looks thin.
 * So the count is said out loud, first, with the kind named: "412 of 415
 * text elements" is a bug report, where a bare "3 dropped" is noise and
 * silence is worse than either.
 */

/** How many entries were refused, by kind; absent kinds lost nothing. */
export type DroppedCounts = Record<string, number | undefined>

/** How many of each kind the page sent, for the denominator. */
export type SentCounts = Record<string, number | undefined>

/** Plural in the reader's terms, not the code's: `text` is "text elements". */
const KIND_NAMES: Record<string, [one: string, many: string]> = {
  targets: ['target', 'targets'],
  text: ['text element', 'text elements'],
  edges: ['edge', 'edges'],
  images: ['image', 'images'],
}

const name = (kind: string, n: number): string => {
  const pair = KIND_NAMES[kind]
  if (pair === undefined) return kind
  return n === 1 ? pair[0] : pair[1]
}

/**
 * The sentence, or null when every entry survived. `sent` is what the page
 * offered of each kind (kept plus dropped), so the denominator is the number
 * the reader would otherwise have expected to see measured.
 */
export function droppedEntriesNote(dropped: DroppedCounts | undefined, sent: SentCounts): string | null {
  if (dropped === undefined) return null
  const parts: string[] = []
  for (const [kind, n] of Object.entries(dropped)) {
    if (n === undefined || n <= 0) continue
    const total = sent[kind]
    parts.push(`${n} of ${total ?? n} ${name(kind, total ?? n)}`)
  }
  if (parts.length === 0) return null
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`
  const total = Object.values(dropped).reduce<number>((n, v) => n + (v ?? 0), 0)
  const [verb, them] = total === 1 ? ['was', 'it'] : ['were', 'them']
  return (
    `${list} the page sent ${verb} dropped: a value in ${them} was outside what the measurement accepts, ` +
    `so the figures below are of the rest`
  )
}
