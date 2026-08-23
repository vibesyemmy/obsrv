import { useShallow } from 'zustand/react/shallow'
import { selectPanelParams, selectProfile, selectScale, selectViewport, useStore } from '../state/store'

export interface PaneFooterProps {
  role: string
  facts: string[]
}

export function PaneFooter({ role, facts }: PaneFooterProps) {
  return (
    <div className="pane-footer">
      <span className="role">{role}</span>
      <span>{facts.join(' · ')}</span>
    </div>
  )
}

export function NativeFooter({ width, height }: { width: number; height: number }) {
  const scaleFactor = useStore(s => s.host.scaleFactor)
  return (
    <PaneFooter
      role="NATIVE"
      facts={[`${width}×${height}`, scaleFactor > 0 ? `×${scaleFactor} host` : 'host unknown']}
    />
  )
}

export function TargetFooter() {
  const viewport = useStore(useShallow(selectViewport))
  const params = useStore(useShallow(selectPanelParams))
  const scale = useStore(selectScale)
  // The sliders' custom profile is labelled "Custom panel"; a preset, by its name.
  const profile = useStore(selectProfile)
  const image = useStore(s => s.image)
  const mode = useStore(s => s.mode)

  const size =
    mode === 'image' && image
      ? `${image.width}×${image.height}`
      : `${viewport.width}×${viewport.height}`
  const depth = params.levels <= 63 ? '6-bit' : '8-bit'

  return (
    <PaneFooter
      role="TARGET"
      facts={[
        size,
        `×${scale.toFixed(2)}`,
        profile.label,
        params.dither ? `${depth}+FRC` : depth,
      ]}
    />
  )
}
