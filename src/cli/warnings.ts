/**
 * One render's warnings, said once each.
 *
 * A render keeps one list for the machine output and says each warning to
 * stderr as it comes. A full-page capture takes a tall page in bands, each
 * captured quiescent on its own, so a page that never goes paint-quiet said
 * "kept painting steadily … capturing the current frame" once per band,
 * verbatim, and the report printed every copy under the screen (measured:
 * five identical lines for apple.com at 1080p-24). A warning describes the
 * page, not the band it was noticed on; a second identical one carries
 * nothing. Warnings that differ — a different band's stuck chrome, a
 * different cap — are all kept, in the order they came.
 *
 * The sink owns the label. A caller says the fact — "full page is 10374 CSS
 * px tall; clamped to 4096" — the list keeps it bare, and only the stderr
 * line carries `warning: `, because a label earns its place at the start of
 * a terminal line and nowhere else. Callers used to compose the label into
 * the message, so the machine list carried stderr formatting; the report
 * then prefixed each entry with where it came from and printed "full page:
 * warning: full page is…" (run 18, uniqlo), and diff printed "target:
 * warning: …" by the same route. Not every caller did it: capture.ts's
 * onWarn messages arrived bare, so one snap's list held both forms. audit,
 * lint and inspect already stored bare and labelled at the boundary
 * (main.ts, `human(\`warning: ${w}\`)` over `result.warnings`); this makes
 * snap and report do what they do. A caller that still composes the label
 * is not corrected here — stderr shows "warning: warning: …", which is the
 * tell that a call site was missed, and quieter than the list silently
 * differing from what was said.
 */
export function warningSink(human: (message: string) => void): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = []
  const warn = (message: string): void => {
    if (warnings.includes(message)) return
    warnings.push(message)
    human(`warning: ${message}`)
  }
  return { warnings, warn }
}
