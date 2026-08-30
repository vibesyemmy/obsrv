import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/store'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectGroup {
  /** Omitted for options that stand outside any group, e.g. "Custom". */
  label?: string
  options: SelectOption[]
}

export interface SelectProps {
  /** Kept as a test and style hook, e.g. `preset-select`. */
  className: string
  value: string
  /** What the shell shows — the chosen option's label, not its id. */
  label: string
  ariaLabel: string
  groups: SelectGroup[]
  onChange: (v: string) => void
}

/** Breathing room between the menu and the window edge, in CSS px. */
const MARGIN = 8
/** Type-ahead resets after this long without a keystroke. */
const TYPEAHEAD_MS = 700

/**
 * A listbox we own, rather than a native `<select>`.
 *
 * The platform popup is an OS window: it floats above everything, which is why
 * it could cover the native pane — and also why it spilled outside the app,
 * drawing a menu taller than the window across the desktop behind it. This one
 * is DOM, so it is clamped to the window by construction: it flips above the
 * trigger when there is more room there, and takes a scrolling max-height
 * rather than growing past the edge.
 *
 * Being DOM costs us the one thing the native control gave away free — it
 * cannot paint over the native `WebContentsView`, which is an OS-composited
 * layer above the renderer. When the menu's rect actually intersects that view,
 * the view is taken off screen for as long as the menu is open and a scrim is
 * drawn in its place. Measured rather than assumed, so a short menu on a wide
 * window never disturbs anything.
 */
export function Select({ className, value, label, ariaLabel, groups, onChange }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const setNativeObscured = useStore(s => s.setNativeObscured)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()

  const flat = groups.flatMap(g => g.options)
  const selectedIndex = Math.max(0, flat.findIndex(o => o.value === value))

  const close = (refocus = true): void => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const commit = (v: string): void => {
    onChange(v)
    close()
  }

  // Position after layout but before paint, so the menu never appears at a
  // wrong place for a frame. Reads the real menu height, which is why it cannot
  // be computed at click time.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const trigger = triggerRef.current
    const list = listRef.current
    if (!trigger || !list) return

    const r = trigger.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - MARGIN
    const above = r.top - MARGIN
    // Prefer below, as a dropdown should; go above only when that genuinely has
    // more room, so the menu does not jump sides for a few pixels.
    const wanted = list.scrollHeight
    const dropDown = below >= wanted || below >= above
    const maxHeight = Math.max(80, dropDown ? below : above)
    const height = Math.min(wanted, maxHeight)
    const top = dropDown ? r.bottom : r.top - height
    // Clamp horizontally too: a menu wider than its trigger near the right edge
    // would otherwise run past it.
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - list.offsetWidth - MARGIN))
    setPos({ left, top, maxHeight })
  }, [open, groups.length])

  // Tell main whether the menu is actually sitting on the native view. The
  // renderer cannot paint over it, so it comes off screen for the duration —
  // but only when it would really be in the way.
  useEffect(() => {
    if (!open || !pos) return
    const list = listRef.current
    const slot = document.querySelector('.native-slot')
    if (!list || !slot) return
    const m = list.getBoundingClientRect()
    const n = slot.getBoundingClientRect()
    const overlaps = m.left < n.right && m.right > n.left && m.top < n.bottom && m.bottom > n.top
    if (!overlaps) return
    setNativeObscured(true)
    return () => setNativeObscured(false)
  }, [open, pos])

  // Scroll the selection into view when the menu opens on a long list.
  useEffect(() => {
    if (!open) return
    setActive(selectedIndex)
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    // Capture, so a press that lands on the target canvas closes the menu
    // before the canvas acts on it.
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('resize', () => close(false), { once: true })
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open])

  const move = (to: number): void => {
    const next = Math.max(0, Math.min(flat.length - 1, to))
    setActive(next)
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        return
      case 'ArrowDown':
        e.preventDefault()
        move(active + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        move(active - 1)
        return
      case 'Home':
        e.preventDefault()
        move(0)
        return
      case 'End':
        e.preventDefault()
        move(flat.length - 1)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (flat[active]) commit(flat[active].value)
        return
      case 'Tab':
        // Tab commits nothing and takes focus onward, as a native select does.
        close(false)
        return
    }
    // Type-ahead: the native control has it, and a fifteen-item list is exactly
    // where it earns its keep.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      typed.current.text = now - typed.current.at > TYPEAHEAD_MS ? e.key : typed.current.text + e.key
      typed.current.at = now
      const q = typed.current.text.toLowerCase()
      const hit = flat.findIndex(o => o.label.toLowerCase().startsWith(q))
      if (hit >= 0) move(hit)
    }
  }

  let index = -1
  return (
    <div className="select-shell" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`select-trigger ${className}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        data-value={value}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="select-label">{label}</span>
        <span className="select-chevron">
          <Icon name="chevron" size={14} />
        </span>
      </button>

      {open && (
        <div
          id={listId}
          ref={listRef}
          className="select-menu"
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          // Hidden until positioned: the first layout pass has to measure the
          // real height, and a menu that flashes at the wrong place is worse
          // than one that appears a frame later.
          style={
            pos
              ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight }
              : { visibility: 'hidden', top: 0, left: 0 }
          }
          onKeyDown={onKeyDown}
        >
          {groups.map((g, gi) => (
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
                    aria-selected={o.value === value}
                    // Pointer down, not click: the mousedown listener above
                    // closes on anything outside, and a click would land after.
                    onMouseDown={e => {
                      e.preventDefault()
                      commit(o.value)
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="select-tick" aria-hidden="true">
                      {o.value === value ? <Icon name="check" size={12} /> : null}
                    </span>
                    {o.label}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
