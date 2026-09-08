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
 */
export function warningSink(human: (message: string) => void): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = []
  const warn = (message: string): void => {
    if (warnings.includes(message)) return
    warnings.push(message)
    human(message)
  }
  return { warnings, warn }
}
