/**
 * The target page's cursor, as CSS for the canvas that stands in for the
 * offscreen window on screen. Chromium reports every cursor change on that
 * window (`webContents` `cursor-changed`); the window has no surface of its
 * own to show it on, so the canvas wears it instead.
 *
 * Electron's names are Chromium's, and two of them are traps: `pointer` is
 * the arrow, and the link hand is `hand`. Everything unknown is the arrow —
 * a cursor the page never asked for is better than a cursor CSS refuses.
 */

const CSS_BY_TYPE: Readonly<Record<string, string>> = {
  default: 'default',
  pointer: 'default',
  hand: 'pointer',
  crosshair: 'crosshair',
  text: 'text',
  wait: 'wait',
  help: 'help',
  'e-resize': 'e-resize',
  'n-resize': 'n-resize',
  'ne-resize': 'ne-resize',
  'nw-resize': 'nw-resize',
  's-resize': 's-resize',
  'se-resize': 'se-resize',
  'sw-resize': 'sw-resize',
  'w-resize': 'w-resize',
  'ns-resize': 'ns-resize',
  'ew-resize': 'ew-resize',
  'nesw-resize': 'nesw-resize',
  'nwse-resize': 'nwse-resize',
  'col-resize': 'col-resize',
  'row-resize': 'row-resize',
  'm-panning': 'all-scroll',
  'e-panning': 'all-scroll',
  'n-panning': 'all-scroll',
  'ne-panning': 'all-scroll',
  'nw-panning': 'all-scroll',
  's-panning': 'all-scroll',
  'se-panning': 'all-scroll',
  'sw-panning': 'all-scroll',
  'w-panning': 'all-scroll',
  move: 'move',
  'vertical-text': 'vertical-text',
  cell: 'cell',
  'context-menu': 'context-menu',
  alias: 'alias',
  progress: 'progress',
  nodrop: 'no-drop',
  copy: 'copy',
  none: 'none',
  'not-allowed': 'not-allowed',
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  grab: 'grab',
  grabbing: 'grabbing',
  null: 'default',
  'drag-drop-none': 'no-drop',
  'drag-drop-move': 'move',
  'drag-drop-copy': 'copy',
  'drag-drop-link': 'alias',
}

export interface CustomCursor {
  /** A `data:image/png;base64,…` URL, as `NativeImage.toDataURL()` produces. */
  dataUrl: string
  hotspot: { x: number; y: number }
}

/** A custom cursor's image is only ever a PNG data URL; anything else is refused. */
const DATA_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/

export const DEFAULT_CURSOR = 'default'

/**
 * CSS `cursor` for a Chromium cursor type. A `custom` cursor becomes a
 * `url()` with its hotspot and the arrow as fallback; one without a usable
 * image is the arrow.
 */
export function cursorCss(type: string, custom?: CustomCursor): string {
  if (type === 'custom') {
    if (!custom || !DATA_PNG.test(custom.dataUrl)) return DEFAULT_CURSOR
    const x = Math.max(0, Math.round(custom.hotspot.x))
    const y = Math.max(0, Math.round(custom.hotspot.y))
    return `url("${custom.dataUrl}") ${x} ${y}, auto`
  }
  return CSS_BY_TYPE[type] ?? DEFAULT_CURSOR
}
