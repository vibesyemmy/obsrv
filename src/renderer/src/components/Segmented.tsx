/** One button of a segmented group. `className` is preserved for test hooks. */
export interface SegmentedOption<T extends string> {
  id: T
  label: string
  title: string
  className?: string
}

export interface SegmentedProps<T extends string> {
  className: string
  ariaLabel: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
}

/**
 * A segmented button group. The pressed state is weight and a fill step,
 * never hue — the UI style spec's rule, and the reason this is a shared
 * component rather than two hand-rolled groups that could drift apart.
 */
export function Segmented<T extends string>({
  className,
  ariaLabel,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          className={o.className}
          title={o.title}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
