import { useShallow } from 'zustand/react/shallow'
import { PANEL_PROFILES } from '../../../shared/presets'
import { selectPanelParams, selectScale, selectViewport, useStore } from '../state/store'

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
  const profileId = useStore(s => s.profileId)
  const override = useStore(s => s.paramsOverride)
  const image = useStore(s => s.image)
  const mode = useStore(s => s.mode)

  const size =
    mode === 'image' && image
      ? `${image.width}×${image.height}`
      : `${viewport.width}×${viewport.height}`
  const depth = params.levels <= 63 ? '6-bit' : '8-bit'
  const profile = PANEL_PROFILES.find(p => p.id === profileId)

  return (
    <PaneFooter
      role="TARGET"
      facts={[
        size,
        `×${scale.toFixed(2)}`,
        override ? 'Custom panel' : (profile?.label ?? profileId),
        params.dither ? `${depth}+FRC` : depth,
      ]}
    />
  )
}
