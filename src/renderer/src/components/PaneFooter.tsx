import type { ReactNode } from 'react'
import { formatTextScale } from '../../../shared/textScale'
import { useShallow } from 'zustand/react/shallow'
import { ppi } from '../../../shared/calibration'
import { cssPxToMm, effectiveContrast, formatRatio, hex } from '../../../shared/contrast'
import { VISION_TYPES, visionIsIdentity, visionMatrix } from '../../../shared/vision'
import {
  selectDeviceScaleFactor,
  selectPanelParams,
  selectProfile,
  selectScale,
  selectScreen,
  selectScreenShape,
  selectTab,
  selectViewport,
  useStore,
} from '../state/store'

export interface PaneFooterProps {
  role: string
  facts: string[]
  /** A control at the far end of the strip; the target's inspector toggle. */
  trailing?: ReactNode
}

export function PaneFooter({ role, facts, trailing }: PaneFooterProps) {
  return (
    <div className="pane-footer">
      <span className="role">{role}</span>
      <span>{facts.join(' · ')}</span>
      {trailing !== undefined && <span className="trailing">{trailing}</span>}
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
  const textScale = useStore(s => selectTab(s).textScale)
  const throttle = useStore(s => selectTab(s).throttle)
  const shape = useStore(selectScreenShape)
  const screen = useStore(useShallow(selectScreen))
  const visionType = useStore(s => selectTab(s).visionType)
  const visionSeverity = useStore(s => selectTab(s).visionSeverity)
  const inspecting = useStore(s => s.inspecting)
  const inspectPinned = useStore(s => s.inspectPinned)
  const inspection = useStore(s => s.inspection)
  const setInspecting = useStore(s => s.setInspecting)

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
  const visionOn = !visionIsIdentity(visionType, visionSeverity)
  const vision = visionOn
    ? [
        `${VISION_TYPES.find(t => t.id === visionType)?.label ?? visionType} ${Math.round(
          visionSeverity * 100,
        )}%`,
      ]
    : []

  // The inspector's readout takes the strip over while it is on: element,
  // size in px and in mm on this screen, the colour pair, and the contrast
  // as stated and as this panel (and viewer) would show it. The second
  // ratio is the point of the whole thing; it is left out only when the
  // panel is the reference and the viewer is normal, when it would repeat
  // the first. Over an image or gradient nothing stated is the colour under
  // the text, and the readout says so rather than guessing.
  let inspect: string[] | null = null
  if (inspecting) {
    if (!inspection) {
      inspect = [mode === 'url' ? 'hover the target' : 'not in image mode']
    } else {
      const r = inspection
      const firstClass = r.classes.split(/\s+/).find(c => c.length > 0)
      const element = `${r.tag}${r.id ? `#${r.id}` : ''}${firstClass ? `.${firstClass}` : ''}`
      // The font size is the page's own CSS px; under a text scale each is
      // `textScale` device px more, and the density is still the screen's.
      const mm = cssPxToMm(r.fontSizePx, dsf * textScale, ppi(screen.width * dsf, screen.height * dsf, screen.diagonalInches))
      const sizeFact = `${Number.isInteger(r.fontSizePx) ? r.fontSizePx : r.fontSizePx.toFixed(1)}px${
        Number.isFinite(mm) ? ` = ${mm.toFixed(1)} mm` : ''
      }${r.fontWeight !== 400 ? ` w${r.fontWeight}` : ''}`
      const fg = hex(r.color)
      if (r.background) {
        const matrix = visionOn ? visionMatrix(visionType, visionSeverity) : undefined
        const c = effectiveContrast(r.color, r.background, params, matrix)
        const plain = profile.id === 'reference' && !visionOn
        inspect = [
          element,
          sizeFact,
          `${fg} on ${hex(r.background)}`,
          `${formatRatio(c.asIs)} here`,
          ...(plain ? [] : [`${formatRatio(c.onPanel)} on ${profile.label}${visionOn ? ` for ${vision[0]}` : ''}`]),
        ]
      } else {
        inspect = [element, sizeFact, `${fg} on an image`, 'contrast not measurable']
      }
      if (inspectPinned) inspect.push('pinned')
    }
  }

  return (
    <PaneFooter
      role={inspect ? 'INSPECT' : 'TARGET'}
      facts={
        inspect ?? [
          size,
          // Stated only when in force: at ×1 the page saw the screen as it is.
          ...(textScale !== 1 ? [`text ${formatTextScale(textScale)}`] : []),
          ...(throttle !== 'none' ? [`throttle ${throttle}`] : []),
          ...magnification,
          profile.label,
          params.dither ? `${depth}+FRC` : depth,
          ...vision,
        ]
      }
      trailing={
        <button
          type="button"
          className="inspect-toggle"
          aria-pressed={inspecting}
          title="Inspect: read the element, size and contrast under the pointer, as this panel shows it"
          onClick={() => setInspecting(!inspecting)}
        >
          Inspect
        </button>
      }
    />
  )
}
