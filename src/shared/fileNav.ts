/** Design-export formats Obsrv can open. Shared by the loader and main's file reader. */
export const IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i

export type FileNavigation = 'allow' | 'block' | 'image'

/**
 * What a pane should do with a renderer-initiated navigation to `to`.
 *
 * An OS file drop on a pane navigates it to `file:///…` — and SyncBus would
 * mirror that into the other pane. A drop of a design export is what image
 * mode is for, so it is reported (`image`) instead of navigated; any other
 * `file:` URL is refused (`block`) unless the page already is a local file,
 * where a relative link or `location.replace` to a sibling is legitimate
 * (the redirect fixture does exactly that). Remote URLs are never touched.
 */
export function classifyFileNavigation(from: string, to: string): FileNavigation {
  if (!to.startsWith('file:')) return 'allow'
  const path = to.split(/[?#]/, 1)[0] ?? ''
  if (IMAGE_EXTENSIONS.test(path)) return 'image'
  return from.startsWith('file:') ? 'allow' : 'block'
}
