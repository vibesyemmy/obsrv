import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuRequest } from '../../../shared/api'
import { Icon } from './Icon'

/** Breathing room between the menu and the window edge, in CSS px. */
const MARGIN = 8
/** Type-ahead resets after this long without a keystroke. */
const TYPEAHEAD_MS = 700

/**
 * What the overlay view renders: whichever menu the chrome has asked for, and
 * nothing else. It spans the whole window, so the empty area around the menu is
 * what catches a click meant to dismiss it — the same thing a native menu's
 * invisible tracking window does.
 *
 * This lives in its own web contents (see `src/main/overlay.ts`), so it cannot
 * read the store. Everything it needs arrives in the request, and the only
 * thing it sends back is the chosen value.
 */
export function MenuLayer() {
  const [request, setRequest] = useState<MenuRequest | null>(null)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const flat = request?.groups.flatMap(g => g.options) ?? []

  useEffect(() => window.obsrv.onMenuShow(setRequest), [])

  // A fresh request starts on its own selected row, not wherever the last menu
  // was left.
  useEffect(() => {
    if (!request) return
    setActive(Math.max(0, flat.findIndex(o => o.value === request.value)))
  }, [request])

  const finish = (value: string | null): void => {
    window.obsrv.pickMenu(value)
    setRequest(null)
    setPos(null)
  }

  // Positioned against the window, and clamped to it: this is what the native
  // popup could not do — being its own OS window, it drew straight past the
  // app's edge.
  useLayoutEffect(() => {
    if (!request) return
    const list = listRef.current
    if (!list) return
    const a = request.anchor
    const below = window.innerHeight - (a.y + a.height) - MARGIN
    const above = a.y - MARGIN
    const wanted = list.scrollHeight
    // Prefer below, as a dropdown should; flip only when that is genuinely
    // roomier, so the menu does not change sides over a few pixels.
    const dropDown = below >= wanted || below >= above
    const maxHeight = Math.max(80, dropDown ? below : above)
    const height = Math.min(wanted, maxHeight)
    const top = dropDown ? a.y + a.height : a.y - height
    const left = Math.max(MARGIN, Math.min(a.x, window.innerWidth - list.offsetWidth - MARGIN))
    setPos({ left, top, maxHeight })
  }, [request])

  // The overlay takes focus when it opens, so the keys arrive here rather than
  // at the trigger that asked for the menu.
  useEffect(() => {
    if (!request) return
    const move = (to: number): void => {
      const next = Math.max(0, Math.min(flat.length - 1, to))
      setActive(next)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          return finish(null)
        case 'ArrowDown':
          e.preventDefault()
          return move(active + 1)
        case 'ArrowUp':
          e.preventDefault()
          return move(active - 1)
        case 'Home':
          e.preventDefault()
          return move(0)
        case 'End':
          e.preventDefault()
          return move(flat.length - 1)
        case 'Tab':
          e.preventDefault()
          return finish(null)
        case 'Enter':
        case ' ':
          e.preventDefault()
          return finish(flat[active]?.value ?? null)
      }
      // Type-ahead, which a fifteen-row list is exactly where it earns its keep.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now()
        typed.current.text = now - typed.current.at > TYPEAHEAD_MS ? e.key : typed.current.text + e.key
        typed.current.at = now
        const q = typed.current.text.toLowerCase()
        const hit = flat.findIndex(o => o.label.toLowerCase().startsWith(q))
        if (hit >= 0) move(hit)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, active, flat.length])

  // Scroll the selected row into view on open, so a long list does not start
  // at the top with the tick out of sight.
  useEffect(() => {
    if (!request || !pos) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
    // Only when the menu first appears, or every arrow key would fight the
    // scrolling the handler above already did.
  }, [pos])

  if (!request) return null

  let index = -1
  return (
    <div className="menu-backdrop" onMouseDown={() => finish(null)}>
      <div
        ref={listRef}
        className="select-menu"
        role="listbox"
        aria-label={request.ariaLabel}
        style={
          pos
            ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight }
            : // Hidden until measured: the first pass needs the real height, and
              // a menu that flashes in the wrong place is worse than one that
              // appears a frame later.
              { visibility: 'hidden', top: 0, left: 0 }
        }
        onMouseDown={e => e.stopPropagation()}
      >
        {request.groups.map((g, gi) => (
          <div className="select-group" role="group" aria-label={g.label} key={g.label ?? gi}>
            {g.label && (
              <div className="select-group-label" aria-hidden="true">
                {g.label}
              </div>
            )}
            {g.options.map(o => {
              index += 1
              const i = index
              return (
                <div
                  key={o.value}
                  role="option"
                  data-index={i}
                  data-value={o.value}
                  className={`select-option${i === active ? ' active' : ''}`}
                  aria-selected={o.value === request.value}
                  onMouseDown={e => {
                    e.stopPropagation()
                    finish(o.value)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="select-tick" aria-hidden="true">
                    {o.value === request.value ? <Icon name="check" size={12} /> : null}
                  </span>
                  {o.label}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
