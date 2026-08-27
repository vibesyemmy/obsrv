import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  EllipsisVertical,
  RotateCw,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react'

/**
 * The chrome's icons, in one place so size, stroke and the accessibility
 * treatment cannot drift between call sites. Every icon is decorative: the
 * control around it carries the `aria-label` and `title`.
 *
 * Lucide draws on a 24px grid at 1.5px stroke, which is already what the UI
 * style spec asks for — no per-icon tuning.
 */
const ICONS = {
  back: ArrowLeft,
  forward: ArrowRight,
  reload: RotateCw,
  overflow: EllipsisVertical,
  close: X,
  sliders: SlidersHorizontal,
  gear: Settings,
  chevron: ChevronDown,
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} aria-hidden="true" focusable="false" />
}
