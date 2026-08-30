import { useShallow } from 'zustand/react/shallow'
import { VISION_TYPES, visionIsIdentity } from '../../../shared/vision'
import {
  selectDeviceScaleFactor,
  selectPanelParams,
  selectProfile,
  selectScale,
  selectScreenShape,
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
  const shape = useStore(selectScreenShape)
  const visionType = useStore(s => selectTab(s).visionType)
  const visionSeverity = useStore(s => selectTab(s).visionSeverity)

  // Mobile presets say their raster density; the magnification readout is
  // already per device pixel (`computeScale` divides by device-pixel PPI).
  // The orientation is named, not left to be inferred: 393×852 and 852×393
  // differ by one transposition and nobody should have to compare digits to
  // tell which way round a screen is. The word comes from the dimensions
  // themselves (`selectScreenShape`), so it can never disagree with them.
  const size =
    mode === 'image' && image
      ? `${image.width}×${image.height}`
      : `${viewport.width}×${viewport.height}${dsf > 1 ? ` @${dsf}x` : ''} ${shape}`
  const depth = params.levels <= 63 ? '6-bit' : '8-bit'
  // Fit mode's readout states the drawn magnification and disclaims it: a
  // minified overview is a map, never the 1x truth the pane exists for.
  const magnification =
    viewMode === 'fit' && fitScale !== null
      ? [`fit ×${fitScale.toFixed(2)}`, 'not pixel-exact']
      : [`×${scale.toFixed(2)}`]

  // Named when it is on, and only then. This readout is what a capture is read
  // against — `obsrv_snap` photographs this pane — so a colour-shifted render
  // with nothing here saying so would be the app quietly lying about its own
  // output. The severity rides along because 40% deutan and full deutan are
  // different pictures.
  const vision = visionIsIdentity(visionType, visionSeverity)
    ? []
    : [
        `${VISION_TYPES.find(t => t.id === visionType)?.label ?? visionType} ${Math.round(
          visionSeverity * 100,
        )}%`,
      ]

  return (
    <PaneFooter
      role="TARGET"
      facts={[
        size,
        ...magnification,
        profile.label,
        params.dither ? `${depth}+FRC` : depth,
        ...vision,
      ]}
    />
  )
}
