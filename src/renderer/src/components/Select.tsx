import { useRef, useState } from 'react'
import type { MenuGroup, MenuOption } from '../../../shared/api'
import { Icon } from './Icon'

export type SelectOption = MenuOption
export type SelectGroup = MenuGroup

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

/**
 * The trigger for a menu, and nothing more: the list itself is drawn by the
 * overlay view, because the native pane is composited above this window's DOM
 * and a menu rendered here would open underneath it. See `src/main/overlay.ts`.
 *
 * `data-value` carries the current id for tests, which drove the `<select>`
 * this replaced with `selectOption`.
 */
export function Select({ className, value, label, ariaLabel, groups, onChange }: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  const openMenu = async (): Promise<void> => {
    const el = triggerRef.current
    if (!el || open) return
    const r = el.getBoundingClientRect()
    setOpen(true)
    const picked = await window.obsrv.openMenu({
      groups,
      value,
      ariaLabel,
      // Window coordinates: the overlay spans the content area, so the menu
      // needs no conversion to place itself under this control.
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
    })
    setOpen(false)
    // Focus comes back here either way — dismissing a menu should not cost the
    // control its place in the tab order.
    el.focus()
    if (picked !== null) onChange(picked)
  }

  return (
    <div className="select-shell">
      <button
        type="button"
        ref={triggerRef}
        className={`select-trigger ${className}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-value={value}
        onClick={() => void openMenu()}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            void openMenu()
          }
        }}
      >
        <span className="select-label">{label}</span>
        <span className="select-chevron">
          <Icon name="chevron" size={14} />
        </span>
      </button>
    </div>
  )
}
