import { SHADOW_TREE_SCRIPT, shadowElementFromPoint } from './scrollHost'

/**
 * Selects the entire contents of the text field or contenteditable host at a
 * viewport point, so a `type` step's replace-by-default can put a real,
 * in-page selection in place before typing — the same selection state a
 * user's own mouse-drag would leave, which the real `keyDown`/`char` events
 * that follow then simply type over.
 *
 * Exists because Electron's `sendInputEvent` cannot do this: a synthetic
 * Cmd+A/Ctrl+A `keyDown` reaches the page's own `keydown` listeners — its
 * `metaKey`/`ctrlKey` reads true — but the browser's native "select all" edit
 * command never fires. That command is resolved through the OS's own
 * key-equivalent dispatch (Cocoa's `interpretKeyEvents:` on macOS), a path
 * `sendInputEvent`'s direct-to-renderer injection bypasses entirely. Measured
 * live in `tests/e2e/flow-type-text.spec.ts`: a field already holding text,
 * retyped without `append`, ended up with the new text appended rather than
 * replacing it — the exact silent-wrong-page shape this feature exists to
 * avoid, just one layer up from where the design first looked for it.
 *
 * Runs in the isolated world, like `inspectTarget` — it reads and mutates
 * selection state, never anything the page's own script defined. Returns
 * false when the point resolves to nothing selectable; the caller types at
 * the current cursor position either way rather than refusing the whole
 * step over a convenience it could not apply.
 */
export function selectAllAtPoint(x: number, y: number): boolean {
  const hit = shadowElementFromPoint(x, y)
  const el = hit instanceof Element ? hit : null
  if (el === null) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select()
    return true
  }
  const host = el.closest('[contenteditable]:not([contenteditable="false"])')
  if (host === null) return false
  const range = document.createRange()
  range.selectNodeContents(host)
  const sel = window.getSelection()
  if (sel === null) return false
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

/** `selectAllAtPoint` as source, for `executeJavaScriptInIsolatedWorld` — same shipping pattern as `INSPECT_SCRIPT`. */
export const SELECT_ALL_SCRIPT = `(() => {\n${SHADOW_TREE_SCRIPT}\n return (${selectAllAtPoint.toString()})\n})()`
