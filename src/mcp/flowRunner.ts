/**
 * The step-runner: drives a validated flow (`src/shared/flow.ts`) over ONE
 * held control session, issuing each step's existing control command in
 * sequence — no new IPC, no new protocol.
 *
 * "Held" is what N independent `obsrv_drive` calls are not: each of those
 * re-resolves the live app from scratch, which is exactly where
 * `bug-canvas-blank-without-notice` and `bug-ipc-native-pane-invisible-once`
 * are hardest to diagnose, mid-flow with no single obvious repro. Holding
 * one session means `deps.call` is resolved once, by the caller, against one
 * `ControlInfo`, and every step in the flow goes through that same function.
 */

import type { NetworkRecord, NetworkState } from '../shared/networkRecord'
import type { Flow, FlowStep } from '../shared/flow'
import {
  probePoints,
  isWhollyVisible,
  noMatchRefusal,
  noPointHitsRefusal,
  probeUnavailableRefusal,
  notBroughtIntoViewRefusal,
  scrollToShow,
  visibleCentre,
  zeroSizeRefusal,
  type Box,
  type Viewport,
} from '../shared/flowClick'
import { acquireFlowLock, defaultFlowLockDeps, releaseFlowLock, type AcquireFlowLockResult, type FlowLockDeps, type FlowLockHolder } from './flowLock'

export type { FlowLockDeps, FlowLockHolder }

/**
 * `ran`: the step's own action call succeeded (its settle check may still
 * have failed — that only means `settled`/`unsettledReason` are absent).
 * `failed`: the step's own action call rejected.
 * `not-reached`: a step never ran because an earlier one failed — its own
 * distinct state, not merely absent, so a reader can never mistake "not
 * attempted" for "not in the flow". The report's front page is specified to
 * lead with what was not covered; it cannot state that from data that does
 * not contain it.
 */
export type FlowStepStatus = 'ran' | 'failed' | 'not-reached'

/**
 * What a stated observation came to. Never pass or fail: an `absent` is
 * something for the QA engineer to read, not a verdict Obsrv pronounces.
 *
 * `present` and `absent` are the only two that claim to know, and `absent`
 * claims it only when the read was complete. `unknown` is everything the
 * runner could not honestly say — the step failed, the page had not
 * settled, the read failed or was cut short — and it is never collapsed
 * into `absent`, because a frame that had not finished painting cannot say
 * something is missing. `not-reached` is a step that never ran, never an
 * implied `absent`.
 */
export type ObservationState = 'present' | 'absent' | 'unknown' | 'not-reached'

export interface ObservationRecord {
  /** The text the QA engineer stated, verbatim. */
  expected: string
  state: ObservationState
  /** Where it looked and, for anything but a plain `present`, what it could
   *  not see or why it did not look. A sentence rather than a code, because
   *  the report prints it: "absent" must stay distinguishable from "looked
   *  somewhere the thing could not be". */
  looked: string
  /** What Obsrv saw where it matched, when the reader has it: the matching
   *  text. An `absent` carries none — nothing measures what was there
   *  instead, and inventing it would be a claim nobody took a reading for. */
  saw?: string[]
}

/** What one read of the page says about one stated text. The reader is
 *  injected because how a page is read is a separate decision from how a
 *  run records it; the runner decides the state from these three facts. */
export interface ObservationReading {
  found: boolean
  /** True when everything the reader is able to read was read. False when it
   *  was cut (a cap, a truncated snippet): a string not found on an incomplete
   *  read is unknown, never absent. */
  complete: boolean
  looked: string
  saw?: string[]
}

export interface FlowStepResult {
  index: number
  action: FlowStep['action']
  target?: string
  status: FlowStepStatus
  /** The step's own control-server reply, when it ran. */
  reply?: Record<string, unknown>
  /** The step's own call's rejection message, when it failed. */
  error?: string
  /** Whether the page had stopped moving by the time this step's settle
   *  check ran — the same fields `obsrv_capture` already emits, threaded
   *  through per step rather than only at the end. Read on a failed step
   *  too: whether the page was still animating when the action failed
   *  distinguishes a timing problem from a settled-page defect. Absent when
   *  the step never ran at all (`not-reached`), or the settle check itself
   *  could not be answered. */
  settled?: boolean
  unsettledReason?: string
  /** The settle check's own capture, base64 PNG — `captureRaster` produces
   *  one to answer `settled` whether or not anything asked for it, so this
   *  reuses it rather than paying for (and re-perturbing timing with) a
   *  second capture when a per-step image is wanted later. */
  data?: string
  /** One record per observation the step stated, in the order stated. Absent
   *  (not empty) for a step that stated none, so a flow without observations
   *  produces exactly the result it always did. */
  observations?: ObservationRecord[]
  /** Where this step ran: the page's address, size and density as the step left
   *  it. Absent when `status` could not be read, and absent entirely on a step
   *  that never ran. */
  page?: FlowStepPage
  /** The requests this step made, when a record could be taken. Absent — not
   *  empty — when it could not, so "no requests" and "no record" stay
   *  distinguishable at the type level and not only in prose. */
  network?: NetworkState
  /** How a selector became a point, for a `click` or `type` step that named
   *  one. Present on the refusals too, carrying what was measured before the
   *  refusal — the box a zero-size element reported is the fact that
   *  explains it. */
  resolved?: FlowStepResolution
  /** For a `type` step that actually dispatched keystrokes. Absent on a
   *  refused or not-reached step: nothing was typed, so there is nothing to
   *  report typing. */
  typed?: FlowStepTyped
}

/**
 * What a `type` step's report carries about the text it entered. `length` is
 * always present — a reproducer needs to know how much was typed whether or
 * not it can see what. `value` is the verbatim text, present only when
 * nothing calls for masking it; when masking applies, `value` is omitted
 * entirely rather than replaced with a placeholder, because a placeholder is
 * still a string written into a shared report and "not recorded" means
 * exactly that nothing is.
 */
export interface FlowStepTyped {
  length: number
  /** Which fact triggered the mask, when one did. Absent exactly when
   *  `value` is present. */
  maskedBecause?: 'password field' | 'secret: true'
  value?: string
}

/**
 * A selector resolved to a point, recorded so a reader can check the join rather
 * than trust it.
 *
 * `rect` is the element's box **as first found**, before any scroll, because that
 * is the measurement the decision was made on; `scrolledTo` is present only when
 * the element had to be brought into view, and its absence is itself a fact — an
 * element already on screen was pressed where it stood.
 */
export interface FlowStepResolution {
  selector: string
  /** In CSS px of the target viewport, which is the space `click` takes. */
  point?: { x: number; y: number }
  rect?: Box
  /** The page-space box, kept because it is what the scroll was computed from. */
  pageRect?: Box
  scrolledTo?: { x: number; y: number }
  viewport?: Viewport
  /** Carried for `type` alone — `click` never reads these. Present whenever
   *  `inspect` answered at all, even a refusal: a `type` step that refuses
   *  for being disabled still resolved an element, and the resolution is
   *  what the refusal explains itself with. */
  editable?: boolean
  inputType?: string | null
  disabled?: boolean
  readOnly?: boolean
}

/**
 * The document's state as a step left it — what a QA engineer needs to get back
 * to where the step ran.
 *
 * **Not a DOM tree, and the report must not imply it is one.** A serialised DOM
 * per step is megabytes, unreadable, and would bury the step summary that
 * `feat-flow-report`'s clause keeps deliberately scannable. Reproduction means
 * reopening the page at the size and density it was driven at, and that is what
 * these four fields are.
 *
 * Every field is optional because every one is copied only when `status`
 * answered with the right type. A `status` that comes back without a `url` gives
 * a record with no `url` rather than an empty string that reads like a page at
 * `about:blank`.
 */
export interface FlowStepPage {
  url?: string
  cssWidth?: number
  cssHeight?: number
  deviceScaleFactor?: number
  /** True when the page was still loading as the step finished. Worth keeping
   *  separate from `settled`: a page can have stopped painting while a fetch it
   *  started is still in flight, and a reproducer wants to know that. */
  loading?: boolean
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Reads `status` and keeps only what came back well-typed. Its own try/catch:
 *  a status that cannot be read must not turn a step's own result into two
 *  failures, exactly as the settle probe above does not. */
/** The step's network batch. Absent when the control call failed or answered a
 *  shape the checks refuse — never an empty batch standing in for a missing one,
 *  which would read as a quiet step. */
async function readNetwork(deps: FlowRunnerDeps): Promise<NetworkState | undefined> {
  let r: Record<string, unknown>
  try {
    r = await deps.call('networkRecord', {})
  } catch {
    return undefined
  }
  if (!Array.isArray(r['records'])) return undefined
  const records = r['records'].filter((x): x is NetworkRecord => typeof x === 'object' && x !== null && typeof (x as NetworkRecord).url === 'string')
  const dropped = typeof r['dropped'] === 'number' && Number.isFinite(r['dropped']) ? r['dropped'] : 0
  const stopped = typeof r['stopped'] === 'string' && r['stopped'].length > 0 ? r['stopped'] : undefined
  return { records, dropped, ...(stopped !== undefined ? { stopped } : {}) }
}

/** The box and the viewport from one `inspect` reply, or nothing when the reply
 *  did not carry them well-typed. Kept separate from the decisions so a
 *  malformed reply refuses in one place. */
function boxOf(v: unknown): Box | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const x = num(r['x'])
  const y = num(r['y'])
  const width = num(r['width'])
  const height = num(r['height'])
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  return { x, y, width, height }
}

/**
 * The element's line boxes from an `inspect` readout, or **undefined** when the app did not report
 * them well-formed.
 *
 * Undefined and `[]` are different facts, though they now differ in **one place only: what a refusal
 * says.** Both try the fixed points inside the box (`probePoints`: the line boxes first when there are
 * any, the fixed points always), and every press is checked against the page either way, so neither can
 * press something the element does not paint. An app older than the field sends no `lineRects`, and its
 * refusal must not claim line boxes were consulted. `[]` is the page saying the element has none, and
 * its refusal says so. (An earlier version of this change treated `[]` as "nothing to press" and refused
 * without trying the fixed points; that dropped buttons that worked, and this comment used to describe
 * it.) One malformed entry makes the whole list unusable for the same reason a malformed `rect` does.
 */
function boxesOf(v: unknown): Box[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Box[] = []
  for (const q of v) {
    const b = boxOf(q)
    if (b === undefined) return undefined
    out.push(b)
  }
  return out
}

/**
 * The first candidate point inside the box that **resolves to the element itself**, asked of the app
 * rather than assumed from the geometry.
 *
 * **Bought by `bug-selector-click-presses-the-gap`.** The centre of a wrapped inline element's border
 * box lands in the leading between its line boxes, which paints as the parent block — so the press
 * reached an `<h3>`, the step reported `ran`, and the flow described a journey it never made. Geometry
 * alone cannot tell: a box legitimately contains points its element does not paint.
 *
 * The check is a call Obsrv already ships. `inspect { at }` answers *what is drawn at this point*, and
 * that is exactly the question — it is how the defect was diagnosed, so using it here needs no new
 * machinery and no new public shape.
 *
 * **Identity is the element's own box, not its name.** Two links in a list are both `a` with the same
 * classes; what separates them is where they are. A point resolving to an element whose box equals the
 * one we measured is that element (or a descendant filling it), which is what a click needs.
 */
async function firstPointThatHits(
  deps: FlowRunnerDeps,
  selector: string,
  rect: Box,
  viewport: Viewport,
  lineRects: Box[] | undefined,
): Promise<{ point: { x: number; y: number } } | { saw: string[]; tried: number; lineBoxes?: number } | { unavailable: string }> {
  // **Where the element's text is, when the page says, and the fixed points after it.** `lineRects` is
  // the element's own boxes (`feat-inspect-line-rects`): a point in one is inside the element, so a wrapped
  // link's first probe lands. They are tried FIRST and never INSTEAD — a button whose label sits over its
  // centre has nothing to report about where it is pressable, and the fixed points still reach its padding.
  // `undefined` is an app older than the field: the fixed points alone, as before.
  const candidates = probePoints(rect, lineRects, viewport)
  const saw: string[] = []
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1
  for (const point of candidates) {
    let r: Record<string, unknown>
    try {
      // **`{ x, y }`, flat.** The control command takes the point at the top level
      // (`parseInspectRequest`); `{ at: { x, y } }` is the MCP tool's shape, one
      // layer up. Sending the wrong one answers 400, and the first version of this
      // probe did exactly that — then swallowed the rejection and pressed the
      // centre anyway, so the check looked like it ran and changed nothing. The
      // e2e caught it; the silent fallback is why it took a second look to see
      // that the fix was not working.
      r = await deps.call('inspect', { x: point.x, y: point.y })
    } catch (e) {
      // **No silent fallback.** A probe that cannot answer means the point is
      // unverified, and pressing an unverified point is the defect this whole
      // change is about — it would report `ran` having possibly pressed the page
      // behind the element. The step fails instead, naming what could not be done.
      return { unavailable: e instanceof Error ? e.message : String(e) }
    }
    if (r['found'] !== true) continue
    const readout = (typeof r['readout'] === 'object' && r['readout'] !== null ? r['readout'] : {}) as Record<string, unknown>
    const hit = boxOf(readout['rect'])
    if (hit !== undefined && near(hit.x, rect.x) && near(hit.y, rect.y) && near(hit.width, rect.width) && near(hit.height, rect.height)) {
      return { point }
    }
    if (typeof readout['element'] === 'string') saw.push(readout['element'])
  }
  return { saw, tried: candidates.length, ...(lineRects !== undefined ? { lineBoxes: lineRects.length } : {}) }
}

/**
 * A selector, pressed: `inspect` for the box, a `scroll` when it is off-screen,
 * and the visible centre as the point — the three-step join
 * `feat-flow-selector-click` is about.
 *
 * **Why the runner and not the resolver.** The resolver turns a sentence into
 * steps and by design issues no calls, so it cannot inspect a page it is not
 * connected to; sequencing three round-trips is exactly what this layer is for.
 * That split is the card's first acceptance line.
 *
 * **Why it re-inspects after scrolling** rather than subtracting the scroll from
 * the first box: a scroll can land somewhere other than where it was aimed (a
 * page at its end, an inner scroller, a layout that reflows as it moves), and the
 * reply's own `scrolled` says where the *page* went, not where the *element* now
 * is. The second reading is the one the click is computed from, so a scroll that
 * did not achieve the placement refuses instead of pressing a guess.
 */
async function pointForSelector(
  deps: FlowRunnerDeps,
  selector: string,
): Promise<{ point: { x: number; y: number }; resolved: FlowStepResolution } | { refusal: string; resolved: FlowStepResolution }> {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : [])
  // `editable` alone keeps three states rather than two: `undefined` is not
  // "computed false" — it is "this app's readout has no such key at all",
  // which is every app built before this field existed. Collapsing that into
  // `false` (as `disabled`/`readOnly` still safely do, since a refusal on
  // `editable` already short-circuits before either is read) would make a
  // too-old app read as "this element does not take text", which is false —
  // the element may be exactly the field a real user would type into.
  type Editability = { editable: boolean | undefined; inputType: string | null; disabled: boolean; readOnly: boolean }
  const look = async (): Promise<({ rect: Box; pageRect: Box; notes: string[]; lineRects: Box[] | undefined } & Editability) | { refusal: string }> => {
    const r = await deps.call('inspect', { selector })
    // **`inspect` puts its notes in two different places, measured rather than
    // assumed.** On a miss they are top-level (`{found: false, readout: null,
    // notes: [...]}` — that is where the "not a valid CSS selector" sentence
    // arrives); on a hit the readout carries its own (`readout.notes`, where
    // "this element is not drawn" arrives) and the top level is usually absent.
    // Reading only the top level is the bug the live run caught: a
    // `display: none` button refused with a bare `0x0` and named no rule. Both
    // are read, so neither sentence is lost.
    const top = strings(r['notes'])
    if (r['found'] !== true) return { refusal: noMatchRefusal(selector, top) }
    const readout = (typeof r['readout'] === 'object' && r['readout'] !== null ? r['readout'] : {}) as Record<string, unknown>
    const rect = boxOf(readout['rect'])
    const pageRect = boxOf(readout['pageRect']) ?? rect
    if (rect === undefined || pageRect === undefined) {
      return { refusal: `inspect found ${JSON.stringify(selector)} but returned no usable box for it, so no point can be computed` }
    }
    // The notes are carried, not a field: `inspect` reports "not drawn" as a
    // sentence (`inspectReadout.ts:148`) and has no `hidden` key at all.
    return {
      rect,
      pageRect,
      notes: [...top, ...strings(readout['notes'])],
      lineRects: boxesOf(readout['lineRects']),
      // `type`'s own facts, carried whether or not this call turns out to be
      // for a click — reading them here costs nothing and keeps them beside
      // the one inspect reply they came from, rather than a second ask.
      editable: readout['editable'] === undefined ? undefined : readout['editable'] === true,
      inputType: typeof readout['inputType'] === 'string' ? readout['inputType'] : null,
      disabled: readout['disabled'] === true,
      readOnly: readout['readOnly'] === true,
    }
  }

  const first = await look()
  if ('refusal' in first) return { refusal: first.refusal, resolved: { selector } }
  const { rect, pageRect, notes, editable, inputType, disabled, readOnly, lineRects } = first
  const editability: Editability = { editable, inputType, disabled, readOnly }

  // Before anything about position: an element with no area has no point inside
  // it at any scroll offset, and `display: none` is the commonest way to get one.
  if (rect.width <= 0 || rect.height <= 0) {
    return { refusal: zeroSizeRefusal(selector, rect, notes), resolved: { selector, rect, pageRect, ...editability } }
  }

  // The viewport `click` will bounds-check against, read from the app rather
  // than assumed from a preset: `status.cssWidth/cssHeight` is the surface's own
  // size, already rotated (`control.ts:169`), and `parseClick` checks the same
  // surface's `getViewport()`.
  const page = await readPageState(deps)
  const viewport: Viewport | undefined =
    page?.cssWidth !== undefined && page.cssHeight !== undefined && page.cssWidth > 0 && page.cssHeight > 0
      ? { width: page.cssWidth, height: page.cssHeight }
      : undefined
  if (viewport === undefined) {
    return {
      refusal: `the app did not report a viewport size, so ${JSON.stringify(selector)} cannot be checked against the area a click must land in`,
      resolved: { selector, rect, pageRect, ...editability },
    }
  }

  if (isWhollyVisible(rect, viewport)) {
    if (visibleCentre(rect, viewport) === null) {
      return {
        refusal: notBroughtIntoViewRefusal(selector, rect, viewport, { x: 0, y: 0 }),
        resolved: { selector, rect, pageRect, viewport, ...editability },
      }
    }
    const hit = await firstPointThatHits(deps, selector, rect, viewport, lineRects)
    if ('unavailable' in hit) {
      return { refusal: probeUnavailableRefusal(selector, hit.unavailable), resolved: { selector, rect, pageRect, viewport, ...editability } }
    }
    if (!('point' in hit)) {
      return { refusal: noPointHitsRefusal(selector, rect, hit.tried, hit.saw, hit.lineBoxes), resolved: { selector, rect, pageRect, viewport, ...editability } }
    }
    return { point: hit.point, resolved: { selector, rect, pageRect, viewport, point: hit.point, ...editability } }
  }

  // Off-screen: scroll, then measure again.
  const scrolledTo = scrollToShow(rect, pageRect, viewport)
  await deps.call('scroll', { x: scrolledTo.x, y: scrolledTo.y })
  const second = await look()
  if ('refusal' in second) return { refusal: second.refusal, resolved: { selector, rect, pageRect, viewport, scrolledTo, ...editability } }
  const secondEditability: Editability = {
    editable: second.editable,
    inputType: second.inputType,
    disabled: second.disabled,
    readOnly: second.readOnly,
  }
  const base: FlowStepResolution = { selector, rect: second.rect, pageRect: second.pageRect, viewport, scrolledTo, ...secondEditability }
  if (visibleCentre(second.rect, viewport) === null) {
    return { refusal: notBroughtIntoViewRefusal(selector, second.rect, viewport, scrolledTo), resolved: base }
  }
  // Same check after the scroll as before it: the element that moved into view is
  // as likely to be a wrapped inline as one that was already there, and the
  // failing case in the wild was exactly this path.
  const hit = await firstPointThatHits(deps, selector, second.rect, viewport, second.lineRects)
  if ('unavailable' in hit) return { refusal: probeUnavailableRefusal(selector, hit.unavailable), resolved: base }
  if (!('point' in hit)) {
    return { refusal: noPointHitsRefusal(selector, second.rect, hit.tried, hit.saw, hit.lineBoxes), resolved: base }
  }
  return { point: hit.point, resolved: { ...base, point: hit.point } }
}

async function readPageState(deps: FlowRunnerDeps): Promise<FlowStepPage | undefined> {
  let s: Record<string, unknown>
  try {
    s = await deps.call('status', {})
  } catch {
    return undefined
  }
  const url = typeof s['url'] === 'string' && s['url'].length > 0 ? s['url'] : undefined
  const cssWidth = num(s['cssWidth'])
  const cssHeight = num(s['cssHeight'])
  const deviceScaleFactor = num(s['deviceScaleFactor'])
  const loading = typeof s['loading'] === 'boolean' ? s['loading'] : undefined
  const page: FlowStepPage = {
    ...(url !== undefined ? { url } : {}),
    ...(cssWidth !== undefined ? { cssWidth } : {}),
    ...(cssHeight !== undefined ? { cssHeight } : {}),
    ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    ...(loading !== undefined ? { loading } : {}),
  }
  // Nothing usable came back. An empty object would render as a "where this ran"
  // block with no facts in it, which is worse than not offering the block.
  return Object.keys(page).length === 0 ? undefined : page
}

export interface FlowRunResult {
  steps: FlowStepResult[]
}

export interface FlowRunnerDeps {
  /** One control-protocol command against the held session. */
  call: (command: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Reads the page for the given stated texts, answering one reading per text
   *  in the same order. Called once per step, after the step has settled and
   *  never before. Without one, every observation is `unknown`. */
  observe?: (texts: string[]) => Promise<ObservationReading[]>
}

const NOT_REACHED = 'the step was not reached, so nothing was read'

/** The state and account for every stated text on a step that did run. Reads
 *  only a step that ran and settled: a failed step's screen is kept elsewhere
 *  but what it was meant to show was not examined, and an unsettled or
 *  unverified frame cannot honestly say something is missing. */
async function recordObservations(
  texts: string[],
  step: { failed: boolean; settled: boolean | undefined; unsettledReason: string | undefined },
  observe: FlowRunnerDeps['observe'],
): Promise<ObservationRecord[]> {
  const unknown = (looked: string): ObservationRecord[] => texts.map(expected => ({ expected, state: 'unknown', looked }))
  if (step.failed) return unknown('the step failed, so what it was meant to show was not examined')
  if (step.settled === false) {
    return unknown(`the page had not settled (${step.unsettledReason ?? 'no reason given'}) when this step finished, so nothing was read`)
  }
  if (step.settled === undefined) {
    return unknown("the step's settle state could not be read, so nothing was read: a missing result would not be honest")
  }
  if (observe === undefined) return unknown('no reader was configured for this run, so nothing was read')
  let readings: ObservationReading[]
  try {
    readings = await observe(texts)
  } catch (e) {
    return unknown(`the read failed (${e instanceof Error ? e.message : String(e)}), so nothing can be said either way`)
  }
  return texts.map((expected, i): ObservationRecord => {
    const r = readings[i]
    if (r === undefined) return { expected, state: 'unknown', looked: 'the reader did not answer for this text, so nothing can be said either way' }
    return {
      expected,
      state: r.found ? 'present' : r.complete ? 'absent' : 'unknown',
      looked: r.looked,
      ...(r.saw !== undefined ? { saw: r.saw } : {}),
    }
  })
}

/** Runs every step of a validated flow in sequence over the one `call`
 *  given — nothing here re-resolves the app per step. Stops running at the
 *  first step whose own action call rejects: later steps assume the flow
 *  reached a particular point, and running them against an unknown app
 *  state would report on a flow that never actually happened. Every step
 *  still gets a result — the ones after a failure are recorded as
 *  `not-reached` rather than left out. */
export async function runFlow(flow: Flow, deps: FlowRunnerDeps): Promise<FlowRunResult> {
  const steps: FlowStepResult[] = []
  let stopped = false
  for (let index = 0; index < flow.steps.length; index++) {
    const step = flow.steps[index]!
    const { action, target, observations, text, secret, append, ...rest } = step
    const stated = observations !== undefined && observations.length > 0 ? observations : undefined

    if (stopped) {
      steps.push({
        index,
        action,
        ...(target !== undefined ? { target } : {}),
        status: 'not-reached',
        ...(stated !== undefined ? { observations: stated.map(expected => ({ expected, state: 'not-reached' as const, looked: NOT_REACHED })) } : {}),
      })
      continue
    }

    let reply: Record<string, unknown> | undefined
    let error: string | undefined
    let resolved: FlowStepResolution | undefined

    // **A `click` that names a target is the one step whose payload this layer
    // builds rather than forwards.** Every other action's `target` is a handle
    // the command itself understands (a tab id, a scroll container); `click`
    // takes coordinates and nothing else, so the selector is resolved to a point
    // here — locate, scroll into view, press — and the control server still
    // receives exactly the payload it has always taken.
    let typed: FlowStepTyped | undefined
    if (action === 'click' && target !== undefined) {
      try {
        const got = await pointForSelector(deps, target)
        resolved = got.resolved
        if ('refusal' in got) {
          // A refusal is the step failing, not the runner throwing: the reason is
          // the useful artefact, and it stops the flow the same way any failed
          // step does.
          error = got.refusal
        } else {
          reply = await deps.call('click', { ...rest, x: got.point.x, y: got.point.y })
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    } else if (action === 'type' && target !== undefined && text !== undefined) {
      // `type` reuses `click`'s own resolution whole (`pointForSelector`) —
      // the wrapped-inline fix and the five refusals apply here unchanged —
      // and adds exactly one more check before pressing: the same `inspect`
      // reply that found the point already says whether the element can
      // take text at all.
      try {
        const got = await pointForSelector(deps, target)
        resolved = got.resolved
        if ('refusal' in got) {
          error = got.refusal
        } else if (got.resolved.editable === undefined) {
          // Not "not editable" — unknown, and named as such: the app answering
          // has no `editable` key in its readout at all, which is every app
          // built before this field existed. Refusing is still the right
          // move (typing blind past that point risks the exact silent
          // failure this feature exists to rule out), but the true cause is
          // the app's age, not the element's kind — Henry's review of #530.
          error = `${JSON.stringify(target)}: this app does not report whether an element accepts typed text, so the step was refused rather than typed blind — it predates the field`
        } else if (got.resolved.editable !== true) {
          error = `${JSON.stringify(target)} resolved to a ${got.resolved.inputType === null ? 'non-input' : `type="${got.resolved.inputType}"`} element that does not accept typed text`
        } else if (got.resolved.disabled === true) {
          error = `${JSON.stringify(target)} is disabled, so it cannot accept typed text`
        } else if (got.resolved.readOnly === true) {
          error = `${JSON.stringify(target)} is read-only, so it cannot accept typed text`
        } else {
          reply = await deps.call('type', { x: got.point.x, y: got.point.y, text, append: append === true })
          const masked = got.resolved.inputType === 'password' || secret === true
          typed = {
            length: text.length,
            ...(masked
              ? { maskedBecause: got.resolved.inputType === 'password' ? ('password field' as const) : ('secret: true' as const) }
              : { value: text }),
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    } else {
      const payload = target !== undefined ? { target, ...rest } : rest
      try {
        reply = await deps.call(action, payload)
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    }

    // Run whether the step's own action succeeded or not: the screen at the
    // moment a step failed is the most useful artefact in a QA report, and
    // whether the page was still animating when it failed is a different
    // bug from the same click failing on a settled page. The probe is its
    // own try/catch, so a capture that cannot run on a broken app just
    // says nothing rather than turning the step's own failure into two.
    let settled: boolean | undefined
    let unsettledReason: string | undefined
    let data: string | undefined
    try {
      const capture = await deps.call('captureRaster', {})
      settled = typeof capture['settled'] === 'boolean' ? capture['settled'] : undefined
      unsettledReason = typeof capture['unsettledReason'] === 'string' ? capture['unsettledReason'] : undefined
      data = typeof capture['data'] === 'string' ? capture['data'] : undefined
    } catch {
      // Can't say — does not change the step's own ran/failed status.
    }

    // Where the step ran, for reproduction. `status` answers from the app's own
    // memory rather than measuring the page — the 2 s budget, not the 20 s one
    // — so this costs a round-trip and perturbs nothing. That is the whole
    // difference between this and a per-step network record, which needs a
    // debugger session and is gated on measuring what it costs.
    //
    // Taken **after** the settle probe, deliberately: the address a step ended
    // at is the one worth reproducing, and a step that navigates is exactly the
    // case where before and after differ. Read on a failed step too — the page
    // a click failed on is the page someone has to reopen.
    const page = await readPageState(deps)

    // What this step asked the network for. Same shape of probe as `status`:
    // its own try/catch, because a record that cannot be taken must not turn a
    // step's own result into two failures. The first call starts the recording,
    // so step 1's batch is the requests its own action made and no earlier ones.
    const network = await readNetwork(deps)

    const recorded =
      stated === undefined ? undefined : await recordObservations(stated, { failed: error !== undefined, settled, unsettledReason }, deps.observe)

    steps.push({
      index,
      action,
      ...(target !== undefined ? { target } : {}),
      status: error === undefined ? 'ran' : 'failed',
      ...(reply !== undefined ? { reply } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(settled !== undefined ? { settled } : {}),
      ...(unsettledReason !== undefined ? { unsettledReason } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(recorded !== undefined ? { observations: recorded } : {}),
      ...(page !== undefined ? { page } : {}),
      ...(network !== undefined ? { network } : {}),
      ...(resolved !== undefined ? { resolved } : {}),
      ...(typed !== undefined ? { typed } : {}),
    })

    if (error !== undefined) stopped = true
  }
  return { steps }
}

export interface FlowRefusal {
  heldBy: FlowLockHolder
  ageMs: number
}

export type StartFlowResult = { ok: true; result: FlowRunResult } | { ok: false; refused: FlowRefusal }

export interface StartFlowDeps extends FlowRunnerDeps {
  /** Defaults to the real, filesystem-backed lock beside `control.json`.
   *  Tests supply their own so a race can be simulated without touching a
   *  real file or a real process table. */
  lock?: FlowLockDeps
  now?: () => number
}

/** Acquires the flow lock, runs the flow, and releases the lock afterward —
 *  always, including when a step fails partway through. Refuses loudly,
 *  rather than queuing, when another flow already holds it. */
export async function startFlow(flow: Flow, deps: StartFlowDeps): Promise<StartFlowResult> {
  const lock = deps.lock ?? defaultFlowLockDeps()
  const acquired: AcquireFlowLockResult = await acquireFlowLock(lock)
  if (!acquired.ok) {
    const now = deps.now ? deps.now() : Date.now()
    return { ok: false, refused: { heldBy: acquired.heldBy, ageMs: now - Date.parse(acquired.heldBy.startedAt) } }
  }
  try {
    const result = await runFlow(flow, { call: deps.call, ...(deps.observe !== undefined ? { observe: deps.observe } : {}) })
    return { ok: true, result }
  } finally {
    await releaseFlowLock(lock)
  }
}

/** The refusal as a sentence, naming who holds it and for how long — a
 *  crashed runner's stale lock reads differently from a live flow because
 *  the age and pid are stated, not implied. */
export function flowRefusalMessage(refused: FlowRefusal): string {
  const secs = Math.max(0, Math.round(refused.ageMs / 1000))
  return (
    `a flow started ${secs}s ago by pid ${refused.heldBy.pid} holds this app; refused rather than queued, ` +
    `since a queued action would land at an unpredictable step boundary inside that flow.`
  )
}
