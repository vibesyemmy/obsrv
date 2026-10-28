import type { ElectronApplication } from '@playwright/test'

/**
 * Whose side went quiet when a frame did not arrive in time: what main last
 * sent on the frame bus, and what the session believes about painting.
 * Extracted from `panes.spec.ts`'s own account (`#267`,
 * bug-canvas-blank-without-notice) so the other members of
 * bug-target-no-frame-family (`visibility.spec.ts`, `orientation.spec.ts`,
 * `rendering.spec.ts`) say the same thing on their own frame-wait failures,
 * instead of leaving a recurrence to say only "a frame did not arrive" again.
 *
 * Read ON FAILURE ONLY, so a healthy run pays nothing for it, and read at
 * the moment the wait gave up rather than before — the state wanted is the
 * state at the moment it gave up, not an earlier one.
 *
 * Its own try/catch: this runs inside a failure path, and a crashed or
 * closed app is one of the states a frame wait can fail in. An exception
 * here must never replace the original failure or lose its message, so a
 * caller appends this string to the failure it already has rather than
 * awaiting it first.
 */
export async function framePaintState(app: ElectronApplication): Promise<string> {
  try {
    const sent = await app.evaluate(() => {
      const g = globalThis as unknown as { __obsrv: { tabs: { frameSent(): { lastSeq: number; ready: boolean } }; session: { painting: boolean } } }
      return { ...g.__obsrv.tabs.frameSent(), painting: g.__obsrv.session.painting }
    })
    return (
      `main sent frame ${sent.lastSeq} (delivery subscribed: ${sent.ready}, session painting: ${sent.painting}). ` +
      `lastSeq 0 or ready false means main never sent one; a high lastSeq with a blank canvas means it did ` +
      // One bus, re-pointed across tabs by `setSource` with a single counter
      // (`frameBus.ts:77`), so this count is NOT scoped to this tab: a
      // non-zero value can predate a tab switch with nothing sent since.
      `and nothing drew it — but the count is the bus's, not this tab's, so a non-zero value may predate a switch.`
    )
  } catch (e) {
    return `main's state could not be read: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
  }
}
