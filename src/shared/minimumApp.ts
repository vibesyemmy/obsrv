import { isNewer } from './update'

/**
 * The oldest app version the tools will drive.
 *
 * **Opeyemi's decision, 2026-09-30** (`chore-minimum-app-version`): *"set the floor at 0.58.0 and refuse
 * below it."* The npm package updates ahead of the installed app, so a new server routinely drives an
 * old one, and five code paths existed only to speak to apps that predate a field. 0.58.0 is the version
 * that shipped `blocked` (`82884e1`), which retires three of those five outright; the two that remain
 * describe an app **inside** the supported range rather than compatibility debt.
 *
 * Raising this is a product decision, not a tidy-up: every raise silently removes a configuration
 * someone may be running. The card is where the reasoning for the current number lives.
 */
export const MINIMUM_APP_VERSION = '0.58.0'

/**
 * Why this app cannot be driven, or null when it can.
 *
 * **Names both versions**, because "unsupported" alone sends the reader hunting a selector, an argument
 * or a page — the three things that are not the problem. The sentence has to make the next action
 * obvious, and the next action is an upgrade.
 *
 * **A version it cannot read is treated as too old**, deliberately. "The app is ancient" and "the app
 * answered something unparseable" both want the same action, and the alternative — proceeding because
 * we could not tell — is the shape this repo has spent a week removing: a silence that fits two facts.
 * Any app new enough to matter reports a clean version.
 */
export function unsupportedAppNote(version: string | undefined): string | null {
  const reported = typeof version === 'string' ? version.trim() : ''
  if (reported === '') {
    return (
      `this Obsrv app did not report a version, so it cannot be driven: the tools need ${MINIMUM_APP_VERSION} or newer. ` +
      `Update the app from https://github.com/vibesyemmy/obsrv/releases and try again.`
    )
  }
  // `isNewer(a, b)` is "is a above b" — so the floor being newer than the app is
  // exactly the refusal case. Reused rather than re-derived: the update check has
  // compared these strings since 0.19.0 and knows about prereleases.
  if (!isNewer(MINIMUM_APP_VERSION, reported)) return null
  return (
    `this Obsrv app is ${reported} and the tools need ${MINIMUM_APP_VERSION} or newer, so the call was refused rather than ` +
    `measured against an app that answers differently. Update the app from https://github.com/vibesyemmy/obsrv/releases.`
  )
}
