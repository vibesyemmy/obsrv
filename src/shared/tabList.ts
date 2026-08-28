/** The minimum a list operation needs; the manager's sessions carry more. */
export interface TabRef {
  id: string
}

export interface CloseResult<T extends TabRef> {
  tabs: T[]
  /** Null when the list is now empty — the caller opens a blank tab. */
  activeId: string | null
}

/**
 * Removes a tab and says which one should take focus. Closing the active tab
 * moves right, because the tab that took its screen position is the one the
 * eye is already on; at the end of the strip there is nothing to the right, so
 * it moves left.
 */
export function closeTab<T extends TabRef>(tabs: T[], closeId: string, activeId: string): CloseResult<T> {
  const index = tabs.findIndex(t => t.id === closeId)
  if (index === -1) return { tabs, activeId }
  const next = tabs.filter(t => t.id !== closeId)
  if (next.length === 0) return { tabs: next, activeId: null }
  if (closeId !== activeId) return { tabs: next, activeId }
  const neighbour = next[Math.min(index, next.length - 1)]!
  return { tabs: next, activeId: neighbour.id }
}

export function canAddTab(count: number, max: number): boolean {
  return count < max
}

/**
 * What the strip shows. The port is kept deliberately: two local dev servers
 * differ only by it, and a host-only label would render them identically.
 */
export function tabTitle(url: string, pageTitle: string): string {
  if (pageTitle.trim() !== '') return pageTitle
  if (url.trim() === '') return 'New tab'
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
