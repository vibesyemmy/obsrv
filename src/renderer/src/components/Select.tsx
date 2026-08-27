import type { ReactNode } from 'react'
import { Icon } from './Icon'

export interface SelectProps {
  /** Kept as a test and style hook, e.g. `preset-select`. */
  className: string
  value: string
  /** What the shell shows — the chosen option's label, not its id. */
  label: string
  ariaLabel: string
  onChange: (v: string) => void
  /** `<option>` and `<optgroup>` elements. */
  children: ReactNode
}

/**
 * Our surface with the platform's behaviour: the shell paints the label and
 * chevron, and a real `<select>` sits transparent on top so the native popup,
 * keyboard handling and accessibility come for free. The native control keeps
 * a real bounding box (opacity, not `display: none`), so Playwright's
 * `selectOption` drives it exactly as before.
 */
export function Select({ className, value, label, ariaLabel, onChange, children }: SelectProps) {
  return (
    <div className="select-shell">
      <span className="select-label" aria-hidden="true">
        {label}
      </span>
      <span className="select-chevron">
        <Icon name="chevron" size={14} />
      </span>
      <select
        className={className}
        value={value}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  )
}
