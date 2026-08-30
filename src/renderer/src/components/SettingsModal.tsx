import { useEffect, useRef, useState } from 'react'
import { SETTINGS_SECTIONS, SettingsPanel, type SettingsSection } from './SettingsPanel'
import { useStore } from '../state/store'

/**
 * Settings, as a modal with its sections down the left.
 *
 * It replaces a drawer and the overflow menu it was reached through. The drawer
 * narrowed the panes to sit beside them, which suits a control you adjust while
 * watching the render — the panel sliders still work that way — but nothing in
 * here is like that. A diagonal, a tab cap, an update preference: you come to
 * set them and leave.
 *
 * While it is open the native pane comes off screen. That view is composited
 * above this window's DOM, so it would otherwise punch a hole through the
 * modal. For a menu that was the wrong trade — the render appeared to vanish
 * for something transient — but a modal is meant to cover what is behind it.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>('display')
  const agentControl = useStore(s => s.settings.agentControl)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)
  const setNativeObscured = useStore(s => s.setNativeObscured)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    setNativeObscured(true)
    dialogRef.current?.focus()
    return () => {
      setNativeObscured(false)
      // Back to whatever opened it, or the next Tab starts from the body.
      ;(previouslyFocused.current as HTMLElement | null)?.focus?.()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    // A modal that lets Tab wander into the chrome behind it is a modal in
    // appearance only: the panes are hidden, so focus would land on controls
    // the user cannot see.
    if (e.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
        onMouseDown={e => e.stopPropagation()}
      >
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`nav-${s.id}${s.id === section ? ' on' : ''}`}
              aria-current={s.id === section}
              onClick={() => setSection(s.id)}
            >
              <span>{s.label}</span>
              {/* The one place the nav reports state rather than naming a
                  section: an open control server is worth seeing from here
                  without visiting the page that governs it. */}
              {s.id === 'agent' && agentControl && <span className="nav-chip">ON</span>}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          <SettingsPanel section={section} />
          <div className="settings-foot">
            <button type="button" className="settings-done" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
