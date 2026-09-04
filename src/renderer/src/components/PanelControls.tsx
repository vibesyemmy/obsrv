import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { formatOnionSkin } from '../../../shared/onionSkin'
import { formatTextScale, TEXT_SCALES } from '../../../shared/textScale'
import { THROTTLE_PROFILES } from '../../../shared/throttle'
import type { PanelProfile } from '../../../shared/types'
import { VISION_TYPES } from '../../../shared/vision'
import { selectHostNits, selectProfile, selectTab, useStore } from '../state/store'
import { Icon } from './Icon'
import { Select, type SelectGroup } from './Select'

/**
 * The drawer's sections, in order. The toolbar keeps what defines the
 * picture — screen, profile, view, panes — and this drawer takes what is
 * set once and read from the footer: the page's conditions, the comparison,
 * the panel, the viewer. A footer fact opens the drawer at its section.
 */
export type PanelSection = 'page' | 'compare' | 'panel' | 'vision'

// The value is the number as a string, like the toolbar's own menus: an
// agent-set scale the menu does not list still reads back from the tab.
const TEXT_SCALE_GROUPS: SelectGroup[] = [
  { options: TEXT_SCALES.map(s => ({ value: String(s), label: `Text ${formatTextScale(s)}` })) },
]
const THROTTLE_GROUPS: SelectGroup[] = [
  { options: THROTTLE_PROFILES.map(t => ({ value: t.id, label: `Throttle ${t.id === 'none' ? 'none' : t.label}` })) },
]
const throttleLabel = (id: string): string => {
  const p = THROTTLE_PROFILES.find(t => t.id === id)
  return `Throttle ${!p || p.id === 'none' ? 'none' : p.label}`
}

/**
 * The top of the contrast slider means "no black lift": it commits
 * `contrastRatio: null`, exactly what the Reference profile carries, and the
 * readout says "off". It is the only slider with an off position. Brightness
 * is always an absolute nits figure in a custom profile — a preset's
 * `nits: null` ("same as host") is resolved against the host the moment the
 * sliders take over, so the hand-tuned panel never silently changes when the
 * host's nits setting does.
 */
export const CONTRAST_MAX = 3000

export const CUSTOM_PROFILE_ID = 'custom'

/** Slider positions, in the units a person thinks in. */
export interface PanelControlValues {
  nits: number
  contrast: number
  gamutPct: number
  bits: 6 | 8
  frc: boolean
}

export function profileToControls(p: PanelProfile, hostNits: number): PanelControlValues {
  return {
    nits: p.nits ?? hostNits,
    contrast: p.contrastRatio ?? CONTRAST_MAX,
    gamutPct: Math.round(p.gamutCoverage * 100),
    bits: p.bits,
    frc: p.frc,
  }
}

/**
 * The custom profile that results from moving the sliders from `base`. With
 * an empty patch it simulates identically to `base` (see the unit tests), so
 * the first slider touch changes only the one value moved.
 */
export function customProfile(
  base: PanelProfile,
  hostNits: number,
  patch: Partial<PanelControlValues>,
): PanelProfile {
  const c = { ...profileToControls(base, hostNits), ...patch }
  return {
    id: CUSTOM_PROFILE_ID,
    label: 'Custom panel',
    contrastRatio: c.contrast >= CONTRAST_MAX ? null : c.contrast,
    gamutCoverage: c.gamutPct / 100,
    bits: c.bits,
    frc: c.frc,
    nits: c.nits,
  }
}

/**
 * A section's explanation, behind an info mark in its heading rather than a
 * paragraph under it: the drawer is a column of controls, and the words are
 * for the first time, not every time. The text is the button's accessible
 * name as well as its bubble, so a screen reader gets it too.
 */
function Info({ tip }: { tip: string }) {
  return (
    <button type="button" className="info" aria-label={tip} data-tip={tip}>
      <Icon name="info" size={12} />
    </button>
  )
}

/** A slider row in the inspector: label left, value pinned right in the mono face. */
function Slider({
  label,
  value,
  className,
  min,
  max,
  step,
  current,
  onChange,
}: {
  label: string
  value: string
  className: string
  min: number
  max: number
  step?: number
  current: number
  onChange: (v: number) => void
}) {
  return (
    <label className="control">
      <span className="control-row">
        <span>{label}</span>
        <span className="num">{value}</span>
      </span>
      <input
        className={className}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        aria-valuetext={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function PanelControls({ focus = null, focusKey = 0 }: { focus?: PanelSection | null; focusKey?: number }) {
  const profile = useStore(useShallow(selectProfile))
  const hostNits = useStore(selectHostNits)
  const setProfileOverride = useStore(s => s.setProfileOverride)
  const root = useRef<HTMLDivElement>(null)

  const v = profileToControls(profile, hostNits)
  const update = (patch: Partial<PanelControlValues>): void =>
    setProfileOverride(customProfile(profile, hostNits, patch))

  // A footer fact brings its section into view and lights it for a beat, so
  // a condition an agent set is one click from the control that undoes it.
  useEffect(() => {
    if (!focus) return
    const el = root.current?.querySelector<HTMLElement>(`[data-section="${focus}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    el.classList.add('flash')
    const t = window.setTimeout(() => el.classList.remove('flash'), 900)
    return () => window.clearTimeout(t)
  }, [focus, focusKey])

  return (
    <div className="controls" ref={root}>
      <PageControls />
      <CompareControls />

      <section className="panel-section" data-section="panel">
      <h2>
        Panel
        <Info tip="Simulates a cheaper screen: dimmer, less contrast, fewer colours. A rough model, not a measured one. Choosing a profile in the toolbar resets these sliders." />
      </h2>

      <Slider
        label="Brightness"
        value={`${v.nits} nits`}
        className="nits-slider"
        min={50}
        // "Same as host" must always be reachable.
        max={Math.max(600, hostNits)}
        step={10}
        current={v.nits}
        onChange={nits => update({ nits })}
      />

      <Slider
        label="Contrast"
        value={v.contrast >= CONTRAST_MAX ? 'off' : `${v.contrast}:1`}
        className="contrast-slider"
        min={100}
        max={CONTRAST_MAX}
        step={50}
        current={v.contrast}
        onChange={contrast => update({ contrast })}
      />

      <Slider
        label="Gamut"
        value={`${v.gamutPct}% sRGB`}
        className="gamut-slider"
        min={0}
        max={100}
        current={v.gamutPct}
        onChange={gamutPct => update({ gamutPct })}
      />

      <label className="control">
        <span className="control-row">
          <span>Bit depth</span>
        </span>
        <select
          className="bits-select num"
          value={v.bits}
          onChange={e => update({ bits: Number(e.target.value) === 6 ? 6 : 8 })}
        >
          <option value={8}>8-bit</option>
          <option value={6}>6-bit</option>
        </select>
      </label>

      <label className="control inline">
        <input
          className="frc-check"
          type="checkbox"
          checked={v.frc}
          onChange={e => update({ frc: e.target.checked })}
        />
        <span>FRC dithering</span>
      </label>

      </section>

      <section className="panel-section" data-section="vision">
        <VisionControls />
      </section>
    </div>
  )
}

/**
 * The page's conditions: browser zoom as reflow, and the network and CPU
 * it loads under. Both per tab, both stated in the footer while in force,
 * and both the controls an agent's `obsrv_drive` lands on — which is why
 * they live where a person can turn them off, not in the screen row.
 */
function PageControls() {
  const textScale = useStore(s => selectTab(s).textScale)
  const setTextScale = useStore(s => s.setTextScale)
  const throttle = useStore(s => selectTab(s).throttle)
  const setThrottle = useStore(s => s.setThrottle)
  return (
    <section className="panel-section" data-section="page">
      <h2>
        Page
        <Info tip="How the page is loaded on the target screen: its zoom level, and how fast a network and processor it gets." />
      </h2>
      <label className="control">
        <span className="control-row">
          <span>Text scale</span>
        </span>
        <Select
          className="text-scale-select"
          value={String(textScale)}
          label={`Text ${formatTextScale(textScale)}`}
          ariaLabel="Text scale"
          groups={TEXT_SCALE_GROUPS}
          onChange={v => setTextScale(Number(v))}
        />
      </label>
      <label className="control">
        <span className="control-row">
          <span>Throttle</span>
        </span>
        <Select
          className="throttle-select"
          value={throttle}
          label={throttleLabel(throttle)}
          ariaLabel="Throttle"
          groups={THROTTLE_GROUPS}
          onChange={setThrottle}
        />
      </label>
    </section>
  )
}

/**
 * The onion skin (shared/onionSkin.ts): the page at HiDPI blended over the
 * target's raster. A slider, because dragging between the two is how an
 * onion skin is read; 0 is off, and off is where every launch starts.
 */
function CompareControls() {
  const onionSkin = useStore(s => selectTab(s).onionSkin)
  const setOnionSkin = useStore(s => s.setOnionSkin)
  return (
    <section className="panel-section" data-section="compare">
      <h2>
        Compare
        <Info tip="Lays a sharp, high-resolution render of the same page over the low-resolution one. Drag the slider to see what the cheap screen changes: text that wraps differently, or a thin line that disappears." />
      </h2>
      <Slider
        label="Onion skin"
        value={formatOnionSkin(onionSkin)}
        className="onion-slider"
        min={0}
        max={100}
        step={5}
        current={Math.round(onionSkin * 100)}
        onChange={pct => setOnionSkin(pct / 100)}
      />
    </section>
  )
}

/**
 * The viewer, kept apart from the panel above it.
 *
 * A panel profile is a *screen*; this is a *person*. Putting "Deutan" in the
 * profile list beside "Budget TN" would say they are the same kind of thing,
 * and they are not — you can have both at once, and the order matters: the
 * screen emits light, then the eye receives it.
 */
function VisionControls() {
  const type = useStore(s => selectTab(s).visionType)
  const severity = useStore(s => selectTab(s).visionSeverity)
  const setVision = useStore(s => s.setVision)

  return (
    <>
      <h2>
        Vision
        <Info tip="Shows the render as someone with a colour vision deficiency would see it, applied after the panel above. Full severity uses published research figures (Machado et al., 2009); the values in between are estimates. It does not replace checking text contrast." />
      </h2>

      <div className="vision-control" role="group" aria-label="Colour vision">
        {VISION_TYPES.map(t => (
          <button
            key={t.id}
            type="button"
            className={`vision-${t.id}`}
            title={t.note}
            aria-pressed={type === t.id}
            onClick={() => setVision(t.id, severity)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Severity is the point, not a refinement: full dichromacy is the rare
          end. Deuteranomaly — partial, not absent — is what most people with a
          colour deficiency actually have, so a tool offering only the extreme
          would simulate the uncommon case and call it the common one. */}
      <Slider
        label="Severity"
        value={`${Math.round(severity * 100)}%`}
        className="vision-severity"
        min={10}
        max={100}
        step={10}
        current={Math.round(severity * 100)}
        onChange={pct => setVision(type, pct / 100)}
      />

    </>
  )
}
