import { useShallow } from 'zustand/react/shallow'
import {
  selectDeviceScaleFactor,
  selectPanelParams,
  selectProfile,
  selectScale,
  selectTab,
  selectViewport,
  useStore,
} from '../state/store'

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
  const image = useStore(s => selectTab(s).image)
  const mode = useStore(s => selectTab(s).mode)
  const viewMode = useStore(s => selectTab(s).viewMode)
  const fitScale = useStore(s => selectTab(s).fitScale)
  const dsf = useStore(selectDeviceScaleFactor)

  // Mobile presets say their raster density; the magnification readout is
  // already per device pixel (`computeScale` divides by device-pixel PPI).
  const size =
    mode === 'image' && image
      ? `${image.width}×${image.height}`
      : `${viewport.width}×${viewport.height}${dsf > 1 ? ` @${dsf}x` : ''}`
  const depth = params.levels <= 63 ? '6-bit' : '8-bit'
  // Fit mode's readout states the drawn magnification and disclaims it: a
  // minified overview is a map, never the 1x truth the pane exists for.
  const magnification =
    viewMode === 'fit' && fitScale !== null
      ? [`fit ×${fitScale.toFixed(2)}`, 'not pixel-exact']
      : [`×${scale.toFixed(2)}`]

  return (
    <PaneFooter
      role="TARGET"
      facts={[size, ...magnification, profile.label, params.dither ? `${depth}+FRC` : depth]}
    />
  )
}
