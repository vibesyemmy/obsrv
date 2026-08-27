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
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
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
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="overflow" />
      </button>
      {open && (
        <div className="overflow-menu" role="menu">
          {children(close)}
        </div>
      )}
    </div>
  )
}
