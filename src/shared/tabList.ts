import type { Orientation } from './types'

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
  // `about:blank` is where every session starts and what an unused tab still
  // holds, so it is the empty tab spelled in Chromium's words rather than an
  // address anyone typed. It has no host, and falling through to the raw
  // string labels a fresh tab `about:blank` — which the screenshot caught.
  if (url.trim() === '' || url.trim() === 'about:blank') return 'New tab'
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * One tab as main describes it to the renderer: identity plus the two strings
 * the strip renders. Main owns tab identity — it owns the sessions — so the
 * renderer mirrors this list rather than minting ids of its own.
 */
export interface TabInfo {
  id: string
  url: string
  /** Chromium's page title, or '' when the page has none yet. */
  title: string
  /**
   * The screen this tab is being viewed on, and the panel simulated over it.
   * Main mirrors both from the renderer's own `uiState` reports, so for a tab
   * the renderer already knows about they say nothing new — they are here for
   * the tab it does *not* know about yet: a restored one, whose screen came
   * off disk before any renderer existed to report it. The store seeds a new
   * entry from them and ignores them afterwards; main is not the authority on
   * a preset, it is only the thing that outlived the last launch.
   */
  presetId: string
  profileId: string
  /** Which way round that screen is held; here for the same restore reason. */
  orientation: Orientation
}

/** The whole strip, as `getTabs` answers and `tabsChanged` publishes it. */
export interface TabSnapshot {
  tabs: TabInfo[]
  activeId: string
}
