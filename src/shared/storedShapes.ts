/**
 * What the three generically-named files Obsrv writes into the **shared**
 * `Application Support/Electron` directory look like at the top level.
 *
 * This module exists for one reason: `obsrv uninstall --remove` must not
 * delete another app's `history.json`, `settings.json` or `tabs.json` out of a
 * directory Obsrv does not own (`bug-uninstall-confirm-unenforced`, and the
 * `confirm` contract in `uninstallPlan.ts` that went unenforced from `f995d71`
 * to here).
 *
 * **Why it is its own file.** The uninstall command is plain Node run from
 * `bin/`, built by `tsconfig.mcp.json`'s narrow include list, while the readers
 * pull in presets, text scales and the whole of `ipcPayloads`. Answering "is
 * this file ours" inside the remover would drag that set into a build that has
 * no other use for it; answering it inline would scatter the definition. So it
 * lives here, alone and with no imports of its own.
 *
 * **These say "shaped like ours", never "certainly ours".** Attribution from
 * content is a guess, and the doc comment these back is careful to call it
 * one. They are written to guess in the direction that costs least when wrong:
 * a file we keep costs its owner one manual delete, a file we remove costs
 * them data they cannot get back.
 *
 * **Why these are stricter than the readers, rather than shared with them.**
 * The card asks that removal reuse `loadHistory`/`parseSettings`/`loadTabs`
 * so a second definition of "valid" cannot drift. Taken literally that is not
 * safe and it is worth saying why: those readers are *forgiving on purpose* —
 * `loadHistory` drops a bad row and keeps the file, `loadTabs` returns an
 * empty list rather than refusing. Forgiveness is right when loading (losing a
 * convenience beats refusing to start) and wrong when attributing, where the
 * question is not "can I use this" but "is this mine". Wiring the strict test
 * into the readers would make `loadHistory` drop every row of a file holding
 * one bad entry — a real regression, bought for nothing.
 *
 * So the two are tied by a **test** instead of by shared code:
 * `storedShapes.test.ts` asserts that anything accepted here loads non-empty
 * through the real reader. Drift then fails a test rather than silently
 * widening what the uninstaller will delete.
 */

/** A JSON object, and not an array — `typeof null` is `'object'`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Obsrv's history file: an array of entries carrying a `url`.
 *
 * **An empty array is refused**, and that is deliberate rather than an
 * oversight. `[]` is what an untouched history looks like in *any* app that
 * stores a list, so it attributes to nobody. Refusing it keeps an empty file
 * of ours that a user can delete by hand; accepting it would take an empty
 * file of theirs that they cannot restore.
 */
export function isHistoryShape(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0 && raw.every(item => isRecord(item) && typeof item.url === 'string')
}

/**
 * Obsrv's tab list: `tabs` and `activeIndex` together, each tab carrying a
 * `url`.
 *
 * **`activeIndex` is what makes an empty tab list attributable**, and getting
 * here took two wrong answers. The first accepted `{"tabs": []}` on the
 * grounds that the `tabs` key was evidence; Idris pointed out while reviewing
 * that the key only restates what the filename already says, exactly as a bare
 * array in `history.json` restates *its* filename — a fair hit. The second
 * answer refused every empty list, which was consistent and threw away a real
 * case: Obsrv's own `tabs.json` with every tab closed is `{"tabs": [],
 * "activeIndex": 0}`, and keeping our own file is a worse outcome than we need
 * to accept.
 *
 * `activeIndex` is a required field of `StoredTabs` that Obsrv writes on every
 * save, and it is not a word another app reaches for while writing a file
 * named `tabs.json`. So it carries what the container key does not: evidence
 * about the *writer* rather than a restatement of the name. `history.json` has
 * no equivalent — an empty history is a bare `[]` with nowhere to put a second
 * field — which is why that one still refuses empty and this one does not. The
 * asymmetry is now about what each format can say, not about which wrapper it
 * happens to use.
 */
export function isTabsShape(raw: unknown): boolean {
  if (!isRecord(raw) || !Array.isArray(raw.tabs) || typeof raw.activeIndex !== 'number') return false
  return raw.tabs.every(tab => isRecord(tab) && typeof tab.url === 'string')
}

/**
 * Obsrv's settings: the two fields it cannot run without and no other app has
 * a reason to write. `parseSettings` defaults every other field, so they are
 * no evidence of authorship; these two are required there and are what makes
 * this file attributable at all.
 */
export function isSettingsShape(raw: unknown): boolean {
  return isRecord(raw) && isPositive(raw.hostDiagonalInches) && isPositive(raw.hostNits)
}

/** Which of the three checks a file carries. */
export type ConfirmKind = 'history' | 'settings' | 'tabs'

/**
 * Whether `raw` — already-parsed JSON — is shaped like the named file of
 * Obsrv's. A caller holding bytes rather than JSON treats a parse failure as
 * `false`: a file that is not JSON at all is nobody's to claim on content.
 */
export function confirmsAs(kind: ConfirmKind, raw: unknown): boolean {
  switch (kind) {
    case 'history':
      return isHistoryShape(raw)
    case 'settings':
      return isSettingsShape(raw)
    case 'tabs':
      return isTabsShape(raw)
  }
}
