import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * The `⋮` popover holding the rare controls.
 *
 * It opens *down and to the left of the right edge*, which is not cosmetic:
 * the native pane is an OS-level `WebContentsView` that covers anything the
 * renderer paints over it, so a menu that reached the left half of the window
 * would be invisible. Right-aligned and 200px wide, it lands over the target
 * pane, which is ordinary renderer DOM. The window's `minWidth` is 900, so
 * the target pane is never narrower than ~450px and the menu always fits.
 *
 * It is a plain popover, deliberately *not* `role="menu"`. APG menu semantics
 * are a package deal: arrow-key roving focus, type-ahead, and moving focus
 * into the menu on open. None of that exists here, and none of it is wanted —
 * this holds four ordinary controls that Tab already reaches in order.
 * Claiming the role without the behaviour is worse than not claiming it, and
 * it costs real information: `menuitem` does not support `aria-pressed`, so
 * the drawer buttons could not announce which drawer is open, and assistive
 * tech that honours menu semantics exposes only `menuitem` descendants, which
 * would silence the two checkboxes entirely. Plain buttons and labelled
 * checkboxes announce correctly on their own. Do not "fix" this back.
 */
export function OverflowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = (): void => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    // A `mousedown` only reaches us for clicks that land in the renderer's own
    // document. The native pane is an OS-level `WebContentsView` on top of it,
    // so clicking the live page delivers no event here at all, and the menu
    // would hang over the target pane until Escape.
    //
    // Two signals cover that gap, because neither covers it alone. A window
    // `blur` catches focus leaving the renderer — but only while the window
    // itself holds OS focus, which is not guaranteed (and is never true under
    // the e2e harness, where the window runs unfocused). Main, on the other
    // hand, sees the native view's `focus` event unconditionally, so it
    // forwards it. Both close the menu; whichever arrives first wins.
    const onBlur = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    const offNativeFocus = window.obsrv.onNativeFocused(onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
      offNativeFocus()
    }
  }, [open])

  return (
    <div className="overflow" ref={ref}>
      <button
        ref={buttonRef}
        className="icon-button overflow-button"
        type="button"
        title="More"
        aria-label="More"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="overflow" />
      </button>
      {open && (
        <div className="overflow-menu">
          {children(close)}
        </div>
      )}
    </div>
  )
}
