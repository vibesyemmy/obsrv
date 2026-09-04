import {
  ArrowLeft,
  Check,
  ArrowRight,
  ChevronDown,
  EllipsisVertical,
  Info,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
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
  info: Info,
  gear: Settings,
  chevron: ChevronDown,
  // The listbox's tick. Marks the chosen row the way the native menu did.
  check: Check,
  plus: Plus,
  // The rotate control's two shapes. A plain outline of the screen you get is
  // the whole affordance — no arrow, no device silhouette: the target may be a
  // monitor as readily as a phone.
  portrait: RectangleVertical,
  landscape: RectangleHorizontal,
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} aria-hidden="true" focusable="false" />
}
