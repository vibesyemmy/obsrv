import type { ElectronApplication } from '@playwright/test'

/**
 * Holds the NATIVE pane out of one address, so a redirect page loaded through `navigate` has one actor.
 *
 * **Why it exists (`bug-redirect-note-missing-not-late`, `#3752`).** `navigate` loads an address into BOTH
 * panes. A page that redirects itself therefore redirects in both, and the sync bus mirrors each pane's
 * landing into the other. When the native pane's redirect lands first, the bus loads the landing address into
 * the target before the target's own page has run its script; the page's navigation never starts, the commit
 * is the bus's, and a spec that asserts "the page redirected itself" fails. The margin between the two actors
 * is single-digit milliseconds on an idle laptop (4 to 6 ms in 35 of 40 runs) and a slower target renderer
 * reverses it: with the target on `cpu-4x`, 21 of 30 runs failed (`#3752`).
 *
 * **What this does.** While held, `native.load(address)` resolves with the address the native pane is
 * already on and loads nothing. The bus's own mirror of the target's commit goes through the same method, so
 * the native pane never follows the redirect page, never redirects, and has no landing to mirror back. The
 * order is not forced by a delay (a delay moves WHEN `navigate` resolves, and with it which note the product
 * writes: measured) but made irrelevant.
 *
 * **What it does NOT cover, and must not be read as covering.** The ordering where the bus wins is the
 * product question on `bug-measured-page-is-not-the-asked-page`: what the reply owes a caller when the bus
 * lands the page before the page's own script runs. A spec using this helper says nothing about that case
 * and must not be taken as pinning it either way.
 *
 * The patch is on the instance (an own property that shadows the prototype's `load`), so releasing it is
 * deleting that property.
 */
export async function holdNativeOutOf(app: ElectronApplication, addresses: readonly string[]): Promise<() => Promise<void>> {
  await app.evaluate((_electron, held: string[]) => {
    const native = (globalThis as unknown as { __obsrv: { native: { load: (input: string) => Promise<string>; webContents: { getURL(): string } } } }).__obsrv.native
    const original = native.load.bind(native)
    native.load = (input: string): Promise<string> => (held.includes(input) ? Promise.resolve(native.webContents.getURL()) : original(input))
  }, [...addresses])
  return async () => {
    await app.evaluate(() => {
      delete (globalThis as unknown as { __obsrv: { native: { load?: unknown } } }).__obsrv.native.load
    })
  }
}
