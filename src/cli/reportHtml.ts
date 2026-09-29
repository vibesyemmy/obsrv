import type { AuditResult, AuditThresholds } from './audit'
import { LINT_RULES, type LintResult, type LintRule } from './lint'
import type { UnsettledReason } from './capture'
import { formatTextScale } from '../shared/textScale'
import type { Walked } from '../shared/types'
import type { DiffMetrics } from './metrics'
import { flowCoverageNote } from '../shared/walkCoverage'

/**
 * The report page: one self-contained HTML file — inline CSS, inline PNGs,
 * no script, nothing fetched — so it can be attached to a PR, mailed, or
 * opened from a folder in a year. Pure: a data object in, a string out, and
 * unit-tested that way. Everything that came from the page under test goes
 * through `escapeHtml`; an element's text is the page's, not ours.
 */

export interface ReportImage {
  /** The encoded bytes, base64. */
  base64: string
  width: number
  height: number
  /**
   * PNG unless said otherwise. Only the full-page overview is JPEG: it is a
   * downsampled map whose job the pins do, while every image that is
   * rasterisation evidence — the render, the 1x-vs-2x pair, the crops —
   * stays lossless, or the report would soften what it exists to show.
   */
  mime?: 'image/png' | 'image/jpeg'
}

/** One located problem: a pin on the full-page overview and a crop of it. */
export interface ReportProblemFeature {
  /** 1-based, matching the pin, the crop and the caption. */
  n: number
  /** Pin centre on the overview, as a fraction of the captured page (0..1). */
  xFrac: number
  yFrac: number
  /** A crop of the region, at the render's own pixels. */
  crop: ReportImage
  /** `tag#id.class`, the page's own selector for the element. */
  element: string
  /** The measured detail, e.g. "24×24 px · 6.07 mm" — already composed, escaped on render. */
  detail: string
}

/**
 * Where a finding is, relative to the full-page capture. `page` can be pinned;
 * the other two cannot, for different reasons a reader needs told apart.
 * `panel` is a finding inside a scroll container the capture never drives (a
 * docs sidebar, a virtualised list) — nowhere in a capture of the page, however
 * far the capture reaches. `below` is the page itself running past what the
 * bands could cover.
 */
export type FindingPlace = 'page' | 'panel' | 'below'

/**
 * Which of the three a finding's rect is. Everything with a `clipped` rect is
 * `panel` regardless of its y: those coordinates are the element's own, not a
 * position on the page (see `AuditRect.clipped`), and comparing them against
 * the captured height is what once put 48 sidebar links "below" a capture that
 * covered the page whole.
 */
export function findingPlace(rect: { y: number; height: number; clipped?: true }, capturedCssHeight: number): FindingPlace {
  if (rect.clipped) return 'panel'
  return rect.y + rect.height / 2 <= capturedCssHeight ? 'page' : 'below'
}

/**
 * The full-page render with the worst findings located on it: an overview
 * image, pins in page-fraction coordinates, and a crop of each. Present only
 * when the screen has findings to show. `belowCapture` counts findings past
 * the captured height (a page taller than the capture could reach);
 * `inPanel` counts those the capture could never show at all.
 */
export interface ReportProblems {
  overview: ReportImage
  features: ReportProblemFeature[]
  belowCapture: number
  inPanel: number
}

export interface ReportScreen {
  presetId: string
  label: string
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  /** Browser zoom as reflow, 1 = none; the render is still the screen's size. */
  textScale: number
  diagonalInches: number | null
  /** Device pixels per inch; null for a custom screen with no diagonal. */
  ppi: number | null
  /** The screen's physical size in mm, when the diagonal is known. */
  physicalMm: { width: number; height: number } | null
  orientation: 'portrait' | 'landscape'
  /** The render, at the screen's device pixels, panel profile applied. */
  png: ReportImage
  settled: boolean
  /** Present when `settled` is false: why (see cli/capture.ts). */
  unsettledReason?: UnsettledReason
  /** Time to paint-quiet from navigation, ms; null when it never settled. Shown when a throttle was named. */
  settledMs?: number | null
  /** The walk before the audit and lint: screenfuls scrolled, and whether it reached the end. Absent under --no-walk. */
  walked?: Walked
  /** Null when the page did not answer the audit. */
  audit: AuditResult | null
  /** Null when the page did not answer the lint. */
  lint: LintResult | null
  /**
   * 1x screens only: the comparison, the 2x reference (downsampled), and the
   * 1x render the comparison was measured on — which is the render *without*
   * the panel profile, since the comparison is about rasterisation and the
   * profile would darken everything past the ink threshold. Null `target`
   * means it is the same image as `png` (the reference profile).
   */
  diff: { metrics: DiffMetrics; target: ReportImage | null; reference: ReportImage } | null
  /** Why there is no diff, when there is none. */
  diffSkipped: string | null
  /** The full page with the worst findings located and cropped; absent when there is nothing to show. */
  problems?: ReportProblems
  warnings: string[]
}

export interface ReportData {
  /**
   * The network and CPU conditions every screen was rendered under, when
   * `--throttle` was given. `heldOn` when a refusal left some screens under
   * others: the throttle asked for, and on how many screens it held.
   * `refused` when it was refused on every screen: the conditions kept, and
   * the label of the throttle asked for.
   */
  throttle?: { id: string; label: string; summary: string; heldOn?: { screens: number; of: number }; refused?: string }
  url: string
  generatedAt: string
  version: string
  profile: { id: string; label: string }
  thresholds: AuditThresholds
  screens: ReportScreen[]
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`
const src = (img: ReportImage): string => `data:${img.mime ?? 'image/png'};base64,${img.base64}`
const mm = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v.toFixed(1)} mm`)
const num = (v: number, places = 1): string => v.toFixed(places)

const CSS = `
:root { color-scheme: light dark; --ink: #1a1a1a; --muted: #666; --line: #d9d9d9; --paper: #fff; --panel: #f6f6f6; --bad: #b3261e; --warn: #fdf1d6; --warn-ink: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --ink: #ececec; --muted: #9a9a9a; --line: #333; --paper: #141414; --panel: #1e1e1e; --bad: #ff7b6e; --warn: #3a2f14; --warn-ink: #ffcf70; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 24px 64px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--paper); }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 40px 0 4px; padding-top: 24px; border-top: 1px solid var(--line); }
h3 { font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.muted { color: var(--muted); }
.facts { margin: 0 0 16px; color: var(--muted); font-size: 14px; }
.facts b { color: var(--ink); font-weight: 600; }
figure { margin: 0; }
figure img { display: block; max-width: 100%; max-height: 720px; width: auto; height: auto; border: 1px solid var(--line); background: #fff; }
figcaption { font-size: 13px; color: var(--muted); margin-top: 6px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 13px; }
td.n { text-align: right; white-space: nowrap; }
.bad { color: var(--bad); font-weight: 600; }
.kind { font-size: 12px; padding: 1px 6px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); white-space: nowrap; }
.note { background: var(--panel); border-left: 3px solid var(--line); padding: 8px 12px; margin: 12px 0; font-size: 14px; }
ul.plain { margin: 8px 0; padding-left: 20px; }
footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.overview { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.overview img { max-height: 1400px; }
.pin { position: absolute; transform: translate(-50%, -50%); min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: var(--bad); color: #fff; font: 700 12px/22px -apple-system, sans-serif; text-align: center; border: 2px solid var(--paper); box-shadow: 0 0 0 1px var(--bad); }
.crops { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-top: 14px; }
.crop { border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.crop img { display: block; max-width: 100%; max-height: 260px; width: auto; border: 0; }
.crop figcaption { margin: 0; padding: 6px 8px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); }
.crop figcaption b { color: var(--bad); }
/* The flow report's three step states. The unknown state has weight of its
   own because the card it was built to is explicit that a step measured on
   an unsettled frame must not fold into clean or dirty: a reader skimming
   for red and finding none must not come away thinking the flow was fine. */
.state { font: 700 12px/18px -apple-system, sans-serif; padding: 1px 8px; border-radius: 9px; border: 1px solid; white-space: nowrap; }
.state.ran { color: var(--muted); border-color: var(--line); }
.state.failed { color: #fff; background: var(--bad); border-color: var(--bad); }
.state.unknown { color: var(--warn-ink); background: var(--warn); border-color: var(--warn-ink); }
.state.skipped { color: var(--muted); border-color: var(--line); border-style: dashed; }
/* A reading is not a verdict. \`saw\` and \`missing\` are deliberately NOT the
   green/red of \`ran\`/\`failed\`: colouring an absent string red would be Obsrv
   pronouncing a step failed, which is the one thing this half must never do —
   a QA engineer can state text that is *meant* to be gone. Distinct from each
   other, level in weight. */
.state.saw { color: var(--ink); border-color: var(--ink); }
.state.missing { color: var(--ink); border-color: var(--ink); border-style: dotted; }
.obs { margin: 8px 0 0; padding: 0; list-style: none; }
.obs li { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--line); }
.obs q { font-style: normal; }
.obs .looked { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
.obs .saw { margin: 2px 0 0; font-size: 13px; }
.where { margin: 6px 0 0; }
.where td { padding: 2px 10px 2px 0; border: 0; vertical-align: top; }
.where td:first-child { color: var(--muted); white-space: nowrap; }
.resolved { margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid var(--line); background: var(--panel); font-size: 14px; }
.resolved q { font-style: normal; }
.net { margin: 6px 0 0; font-size: 13px; }
.net td, .net th { padding: 2px 10px 2px 0; text-align: left; }
.net code { word-break: break-all; }
.gap { border-left-color: var(--bad); }
.step { margin: 28px 0; padding-top: 16px; border-top: 1px solid var(--line); }
.step h3 { margin: 0 0 10px; text-transform: none; letter-spacing: 0; font-size: 15px; color: var(--ink); }
.halves { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 10px 0; }
@media (max-width: 720px) { .halves { grid-template-columns: 1fr; } }
.half { border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; }
.half.asked { border-style: dashed; }
.half h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
details { margin-top: 8px; font-size: 13px; }
details pre { overflow-x: auto; background: var(--panel); padding: 8px 10px; border-radius: 3px; margin: 6px 0 0; }
`

function auditSection(s: ReportScreen, thresholds: AuditThresholds): string {
  if (!s.audit) return `<h3>Audit</h3><p class="note">The page did not answer the audit (it may have navigated away, or thrown while being measured).</p>`
  const a = s.audit
  const t = a.summary.targets
  const x = a.summary.text
  const under = (n: number | null): string => (n === null ? '—' : n === 0 ? '0' : `<span class="bad">${n}</span>`)
  // Grouped: forty footer links of one height are one row. The exemplar is
  // the smallest member, so the millimetres shown are the worst in the group.
  const rows = a.groups
    .map(
      g =>
        `<tr><td><span class="kind">${g.kind === 'small-target' ? 'target' : 'text'}</span></td><td class="n">${g.count}</td>` +
        `<td><code>${escapeHtml(g.exemplar.element)}</code>${g.count > 1 ? ` <span class="muted">and ${g.count - 1} more</span>` : ''}</td>` +
        `<td>${escapeHtml(g.exemplar.text)}</td><td class="n">${escapeHtml(g.key)}</td><td class="n bad">${num(g.exemplar.mm, 2)} mm</td></tr>`,
    )
    .join('')
  const more = a.truncated.findings > 0 ? `<p class="muted">${a.truncated.findings} more finding(s) not listed.</p>` : ''
  const none = a.findings.length === 0 ? `<p class="muted">Nothing under the thresholds.</p>` : ''
  return (
    `<h3>Audit — millimetres on this screen</h3>` +
    `<table><tr><th></th><th class="n">Count</th><th class="n">Under threshold</th><th class="n">Smallest</th></tr>` +
    `<tr><td>Tap targets (shorter side, under ${thresholds.tapMm} mm)</td><td class="n">${t.count}</td><td class="n">${under(t.under)}</td><td class="n">${mm(t.smallestMm)}</td></tr>` +
    `<tr><td>Text (font size, under ${thresholds.textMm} mm)</td><td class="n">${x.count}</td><td class="n">${under(x.under)}</td><td class="n">${mm(x.smallestMm)}</td></tr></table>` +
    (a.findings.length > 0
      ? `<table style="margin-top:12px"><tr><th></th><th class="n">Count</th><th>Element</th><th>Text</th><th class="n">CSS</th><th class="n">Smallest</th></tr>${rows}</table>`
      : '') +
    none +
    more +
    (a.warnings.length > 0 ? `<ul class="plain muted">${a.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '')
  )
}

function problemsSection(s: ReportScreen): string {
  const p = s.problems
  if (!p || p.features.length === 0) return ''
  const pins = p.features.map(f => `<span class="pin" style="left:${pct(f.xFrac)};top:${pct(f.yFrac)}">${f.n}</span>`).join('')
  const crops = p.features
    .map(
      f =>
        `<figure class="crop"><img src="${src(f.crop)}" alt="Finding ${f.n}: ${escapeHtml(f.element)}">` +
        `<figcaption><b>${f.n}</b> <code>${escapeHtml(f.element)}</code> · ${escapeHtml(f.detail)}</figcaption></figure>`,
    )
    .join('')
  const below =
    (p.belowCapture > 0
      ? `<p class="muted">${p.belowCapture} more finding(s) sit below the captured area — the page is taller than the capture can reach on this screen.</p>`
      : '') +
    (p.inPanel > 0
      ? `<p class="muted">${p.inPanel} more finding(s) sit inside a panel with its own scrollbar — a sidebar, a list, a drawer. ` +
        `A capture of the page scrolls the page, so those never appear in it however far it reaches; they are listed above and ` +
        `you reach them by scrolling the panel itself.</p>`
      : '')
  const many = p.features.length === 1 ? 'the smallest finding, located on the page' : `the ${p.features.length} smallest findings, located on the page`
  return (
    `<h3>Where the problems are — ${many}</h3>` +
    `<div class="overview"><img src="${src(p.overview)}" alt="The full page, with the worst findings marked">${pins}</div>` +
    `<div class="crops">${crops}</div>` +
    below
  )
}

const LINT_LABEL: Record<LintRule, string> = {
  hairline: 'hairline',
  'thin-text': 'thin text',
  contrast: 'contrast',
  'contrast-on-panel': 'contrast on panel',
  'image-upscaled': 'upscaled image',
  'image-oversized': 'oversized image',
}

function lintSection(s: ReportScreen): string {
  if (!s.lint) return `<h3>Lint</h3><p class="note">The page did not answer the lint (it may have navigated away, or thrown while being measured).</p>`
  const l = s.lint
  const cell = (n: number): string => (n === 0 ? '0' : `<span class="bad">${n}</span>`)
  const summary =
    `<table><tr>${LINT_RULES.map(r => `<th class="n">${escapeHtml(LINT_LABEL[r])}</th>`).join('')}</tr>` +
    `<tr>${LINT_RULES.map(r => `<td class="n">${cell(l.summary[r])}</td>`).join('')}</tr></table>`
  const rows = l.groups
    .map(
      g =>
        `<tr><td><span class="kind">${escapeHtml(LINT_LABEL[g.rule])}</span></td><td class="n">${g.count}</td>` +
        `<td><code>${escapeHtml(g.exemplar.element)}</code>${g.count > 1 ? ` <span class="muted">and ${g.count - 1} more</span>` : ''}</td>` +
        `<td>${escapeHtml(g.key)}</td><td>${escapeHtml(g.exemplar.message)}</td></tr>`,
    )
    .join('')
  const skipped =
    (l.skipped.textOnImages > 0 ? `<p class="muted">${l.skipped.textOnImages} text element(s) sit on an image or gradient and got no contrast verdict.</p>` : '') +
    (l.skipped.invisibleText > 0 ? `<p class="muted">${l.skipped.invisibleText} text element(s) are the same colour as their background: hidden by design or broken, not judged.</p>` : '') +
    (l.skipped.spacers > 0 ? `<p class="muted">${l.skipped.spacers} image(s) are files of a pixel or two on a side stretched into gaps — spacers, not pictures — and were not judged.</p>` : '')
  return (
    `<h3>Lint — what this screen and its panel break</h3>` +
    summary +
    (l.groups.length > 0
      ? `<table style="margin-top:12px"><tr><th></th><th class="n">Count</th><th>Element</th><th>What they share</th><th>Finding</th></tr>${rows}</table>`
      : `<p class="muted">Nothing the rules catch.</p>`) +
    skipped +
    (l.warnings.length > 0 ? `<ul class="plain muted">${l.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '')
  )
}

function diffSection(s: ReportScreen): string {
  if (!s.diff) {
    return s.diffSkipped ? `<h3>1x vs 2x</h3><p class="muted">No comparison: ${escapeHtml(s.diffSkipped)}.</p>` : ''
  }
  const m = s.diff.metrics
  const ratio = m.rows.ratio === null ? 'n/a' : num(m.rows.ratio, 2)
  const target = s.diff.target ?? s.png
  const unprofiled = s.diff.target !== null ? ', without the panel profile — the comparison is about rasterisation' : ''
  // A negative delta is a verdict — ink lost at 1x — only when both captures
  // are of the same frame. Unsettled, the cell wore `bad` while the note
  // beneath the table called the same number noise; colour says "look at
  // this" and the reader took the colour (run 18). So the verdict follows
  // `settled`, and the sentence saying why sits with the numbers it is
  // about, before them, rather than after the findings list where a reader
  // who stopped at the table never reached it.
  const verdict = m.settled && m.inkCoverage.delta < 0 ? ' bad' : ''
  const unsettled = m.settled
    ? ''
    : `<p class="note">Unsettled: the page kept painting, so the two captures are different frames — the ink coverage delta, the rows ratio and every band delta here are frame-to-frame noise, not rendering evidence.</p>`
  return (
    `<h3>1x vs 2x — this screen against the one it was designed on</h3>` +
    `<div class="pair">` +
    `<figure><img src="${src(target)}" alt="This screen"><figcaption>This screen, 1x, ${target.width}×${target.height} device px${unprofiled}</figcaption></figure>` +
    `<figure><img src="${src(s.diff.reference)}" alt="2x reference"><figcaption>2x reference, box-downsampled to the same grid</figcaption></figure>` +
    `</div>` +
    unsettled +
    `<table style="margin-top:12px"><tr><th></th><th class="n">This screen</th><th class="n">Reference</th><th class="n">Delta</th></tr>` +
    `<tr><td>Ink coverage</td><td class="n">${pct(m.inkCoverage.target)}</td><td class="n">${pct(m.inkCoverage.reference)}</td><td class="n${verdict}">${pct(m.inkCoverage.delta)}</td></tr>` +
    `<tr><td>Ink rows (ratio ≈0.5 is normal scaling)</td><td class="n">${m.rows.target}</td><td class="n">${m.rows.reference}</td><td class="n">${ratio}</td></tr></table>` +
    (m.findings.length > 0 ? `<ul class="plain">${m.findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : `<p class="muted">No band findings.</p>`)
  )
}

function screenSection(s: ReportScreen, thresholds: AuditThresholds): string {
  const physical = s.physicalMm ? `${num(s.physicalMm.width, 0)}×${num(s.physicalMm.height, 0)} mm` : 'size unknown (no diagonal)'
  const density = s.ppi !== null ? `${num(s.ppi, 0)} ppi` : 'density unknown'
  return (
    `<section id="${escapeHtml(s.presetId)}">` +
    `<h2>${escapeHtml(s.label)}</h2>` +
    `<p class="facts"><b>${s.cssWidth}×${s.cssHeight}</b> CSS px${s.deviceScaleFactor !== 1 ? ` at <b>${s.deviceScaleFactor}x</b>` : ''} · ` +
    `${s.png.width}×${s.png.height} device px · ${physical} · ${density} · ${escapeHtml(s.orientation)}` +
    `${s.textScale !== 1 ? ` · text <b>${escapeHtml(formatTextScale(s.textScale))}</b>` : ''}` +
    `${s.settledMs === undefined ? '' : s.settledMs === null ? ' · <span class="bad">never settled</span>' : ` · settled in <b>${num(s.settledMs / 1000, 1)} s</b>`}` +
    `${s.settled ? '' : ' · <span class="bad">not settled</span>'}` +
    `${s.walked ? ` · walked <b>${s.walked.screenfuls}</b> screenful${s.walked.screenfuls === 1 ? '' : 's'}${s.walked.atEnd ? '' : ' <span class="bad">(not to the end)</span>'} before measuring` : ''}</p>` +
    // The screen's own figure: always for a screen with no comparison, and
    // for a compared screen only when the profile made it a different image
    // from the one the comparison shows.
    (s.diff && s.diff.target === null
      ? ''
      : `<figure><img src="${src(s.png)}" alt="${escapeHtml(s.label)}"><figcaption>Shown scaled to fit; ${s.png.width}×${s.png.height} device px on a screen ${physical}${s.diff ? ', through the panel profile' : ''}.</figcaption></figure>`) +
    problemsSection(s) +
    diffSection(s) +
    auditSection(s, thresholds) +
    lintSection(s) +
    (s.warnings.length > 0 ? `<h3>Warnings</h3><ul class="plain muted">${s.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '') +
    `</section>`
  )
}

export function reportHtml(data: ReportData): string {
  const url = escapeHtml(data.url)
  const nav = data.screens.map(s => `<a href="#${escapeHtml(s.presetId)}">${escapeHtml(s.label)}</a>`).join(' · ')
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>Obsrv report — ${url}</title>\n<style>${CSS}</style>\n</head>\n<body>\n<main>\n` +
    `<h1>Obsrv report</h1>\n<p class="facts"><a href="${url}">${url}</a><br>` +
    `Panel profile <b>${escapeHtml(data.profile.label)}</b> · thresholds ${data.thresholds.tapMm} mm targets, ${data.thresholds.textMm} mm text · ` +
    `${data.throttle ? `throttle <b>${escapeHtml(data.throttle.label)}</b> (${escapeHtml(data.throttle.summary)})${data.throttle.heldOn ? ` on ${data.throttle.heldOn.screens} of ${data.throttle.heldOn.of} screens — refused on the others, which say so` : ''}${data.throttle.refused ? ` — ${escapeHtml(data.throttle.refused)} was refused on every screen, which say so` : ''} · ` : ''}` +
    `${escapeHtml(data.generatedAt)} · obsrv ${escapeHtml(data.version)}</p>\n` +
    `<p>The same page on the screens people own. Each render is at the screen's true density; the audit measures ` +
    `tap targets and text in millimetres on that screen; 1x screens are compared with the 2x display the page was ` +
    `probably designed on; the lint names the elements a 1x screen and a cheap panel break, grouped by what they share.</p>\n<p class="muted">${nav}</p>\n` +
    data.screens.map(s => screenSection(s, data.thresholds)).join('\n') +
    `\n<footer>Thresholds are provisional and stated above; findings are informational. Images are shown scaled to fit — ` +
    `open them at 1:1, or the page in Obsrv, for the actual pixels; the full-page overview is a JPEG map, everything else is lossless. Generated by obsrv ${escapeHtml(data.version)}.</footer>\n` +
    `</main>\n</body>\n</html>\n`
  )
}

/**
 * A flow report: one section per step, and a front page that says what it did
 * not cover before it says what it found.
 *
 * A sibling of `reportHtml` rather than a mode of it. `obsrv_report` is
 * headless by design and a flow is inherently live; the two documents share
 * this file's CSS and escaping, and nothing else.
 */
export type FlowStepState = 'ran' | 'failed' | 'not-reached'

export interface FlowReportStep {
  action: string
  target?: string
  status: FlowStepState
  error?: string
  settled?: boolean
  unsettledReason?: string
  reply?: Record<string, unknown>
  /** Base64 PNG of the pane as this step left it, when one was captured. */
  data?: string
  /** What the QA engineer said they expected to see at this step, carried on
   *  the step itself. Obsrv does not evaluate it — see `askedHalf`. */
  expect?: string
  /** One record per text the step stated, in the order stated. Absent — not
   *  empty — for a step that stated none, so a flow without observations
   *  renders exactly the document it always did. */
  observations?: FlowReportObservation[]
  /** Where the step ran. Absent when `status` could not be read, and on a step
   *  that never ran. */
  page?: FlowReportPageState
  /** The requests this step made. Absent when no record could be taken — which
   *  the renderer says out loud, because an absent record and a quiet step are
   *  opposite facts and both would otherwise be an empty section. */
  network?: FlowReportNetwork
  /** The sentence this step was resolved from, when the flow was given as a
   *  description rather than as a step list. Absent for a hand-written step. */
  clause?: string
  /** The words the resolver actually matched on — taken from the match, never
   *  written out beside the pattern, so the trace cannot claim a phrase the rule
   *  did not match. */
  keyedOn?: string
}

/** The page's address, size and density as a step left it — what somebody needs
 *  to get back to where the step ran.
 *
 *  **Not a DOM tree**, and `pageStateBlock` says so in the document rather than
 *  leaving "for reproduction" to imply it. A serialised DOM per step would be
 *  megabytes and would bury the step summary this report keeps scannable; a QA
 *  engineer reproducing a step reopens the page at the size it was driven at.
 *  Every field is optional: the runner copies only what `status` answered with
 *  the right type, so a missing field means "not reported", never a default. */
export interface FlowReportPageState {
  url?: string
  cssWidth?: number
  cssHeight?: number
  deviceScaleFactor?: number
  loading?: boolean
}

/** What Obsrv can say about one stated text, structurally rather than by
 *  importing the runner's `ObservationRecord`: this file is the CLI's renderer
 *  and takes no dependency on `src/mcp/`, the same reason `walkCoverage` keeps
 *  its own step shape. The fields match the runner's one for one.
 *
 *  **`unknown` is the common case today and is not a defect.** No reader is
 *  configured on the `obsrv_flow` path yet (`feat-flow-observations`), so every
 *  stated text comes back `unknown` carrying the sentence *"no reader was
 *  configured for this run, so nothing was read"*. Printing that is the honest
 *  thing: it tells a QA engineer their expectation was recorded and **not**
 *  checked, which is precisely what a silent omission would hide. When the
 *  reader lands, `present` and `absent` start appearing here with no further
 *  change to this file. */
export interface FlowReportObservation {
  /** The text as the QA engineer wrote it. Rendered verbatim, never normalised
   *  — a trailing space they cared about is theirs to see. */
  expected: string
  state: 'present' | 'absent' | 'unknown' | 'not-reached'
  /** Where Obsrv looked, or why it did not. Always printed: it is what keeps
   *  `absent` ("read the page, the text was not there") distinguishable from
   *  the several different `unknown`s, which otherwise collapse into one
   *  shrug. */
  looked: string
  /** The matching text, when the reader has it. An `absent` carries none —
   *  nothing measured what stood there instead, and inventing it would be a
   *  claim nobody took a reading for. */
  saw?: string[]
}

export interface FlowReportData {
  /** The address the flow drove to, when it drove to one. **Absent when the
   *  flow never navigates** — which is the ordinary case for a QA engineer
   *  picking up a page the app already had open, not an edge. The first version
   *  of this took a required string and `flowSubject` handed it the sentence
   *  "the page the app already had open", which the header then rendered into
   *  `<a href="...">`: a broken link whose href was a sentence. */
  url?: string
  generatedAt: string
  version: string
  steps: FlowReportStep[]
  /** Set when the flow never ran because another flow held the app. */
  refused?: string
}

/** A step's state as the report shows it. `ran` is only `ran` when the page
 *  had stopped moving: a step whose evidence was photographed mid-paint is
 *  `unknown`, which is the whole point of having a third state. */
export function flowStepState(s: FlowReportStep): { cls: string; label: string } {
  if (s.status === 'failed') return { cls: 'failed', label: 'failed' }
  if (s.status === 'not-reached') return { cls: 'skipped', label: 'not reached' }
  if (s.settled === true) return { cls: 'ran', label: 'ran' }
  return { cls: 'unknown', label: 'unknown' }
}

function measuredHalf(s: FlowReportStep): string {
  const bits: string[] = []
  if (s.status === 'not-reached') {
    bits.push(`<p class="muted">Nothing was measured: the flow stopped before this step.</p>`)
  } else {
    if (s.error !== undefined) bits.push(`<p class="bad">${escapeHtml(s.error)}</p>`)
    if (s.settled === true) bits.push(`<p>The page had stopped painting when this step's evidence was taken.</p>`)
    else if (s.settled === false) bits.push(`<p><b>The page was still painting</b>${s.unsettledReason ? ` (${escapeHtml(s.unsettledReason)})` : ''} — the evidence below may be a frame behind what this step produced.</p>`)
    else bits.push(`<p><b>Whether the page had settled could not be checked</b>, so whether the evidence below is current is unknown rather than fine.</p>`)
  }
  return `<div class="half"><h4>What Obsrv measured</h4>${bits.join('')}</div>`
}

/** The step's requests, structurally rather than by importing the runner's
 *  `NetworkState`: this file is the CLI renderer and takes no dependency on
 *  `src/mcp/` or on main. Fields match one for one. */
export interface FlowReportNetwork {
  records: Array<{ method: string; url: string; status?: number; type?: string }>
  dropped: number
  /** Why recording stopped, when it did. Its presence is what separates an empty
   *  list meaning *"this step asked for nothing"* from one meaning *"nobody was
   *  listening"*. */
  stopped?: string
}

/** A reading's badge. Separate from `flowStepState` on purpose: a step's state
 *  and a stated text's state are different questions, and one must never be
 *  read off the other. A step can run cleanly with its stated text absent, and
 *  a failed step's texts are `unknown` rather than absent. */
export function observationState(o: FlowReportObservation): { cls: string; label: string } {
  if (o.state === 'present') return { cls: 'saw', label: 'text found' }
  if (o.state === 'absent') return { cls: 'missing', label: 'text not found' }
  if (o.state === 'not-reached') return { cls: 'skipped', label: 'never looked' }
  return { cls: 'unknown', label: 'not read' }
}

/** The stated texts, each with what Obsrv can and cannot say about it.
 *
 *  Every record prints its `looked` sentence, including a `present` one. The
 *  first version printed it only for the states that were not `present`, on
 *  the reasoning that a found string needs no explanation — which quietly made
 *  the page's most trustworthy row its least evidenced one. Where Obsrv looked
 *  is what makes a reading checkable. */
function observationList(records: FlowReportObservation[]): string {
  const items = records
    .map(o => {
      const st = observationState(o)
      const saw =
        o.saw !== undefined && o.saw.length > 0
          ? `<p class="saw">It read: ${o.saw.map(t => `<q>${escapeHtml(t)}</q>`).join(', ')}</p>`
          : ''
      return (
        `<li><q>${escapeHtml(o.expected)}</q> <span class="state ${st.cls}">${st.label}</span>` +
        `<p class="looked">${escapeHtml(o.looked)}</p>${saw}</li>`
      )
    })
    .join('')
  return `<ul class="obs">${items}</ul>`
}

function askedHalf(s: FlowReportStep): string {
  const head = `<div class="half asked"><h4>What you asked to see</h4>`
  const stated = s.expect !== undefined ? `<p>${escapeHtml(s.expect)}</p>` : ''
  if (s.observations !== undefined && s.observations.length > 0) {
    // Report, don't decide, and the line has to be exact now that some rows
    // carry a real reading. "Obsrv does not judge this" full stop was true when
    // every row was a bare sentence; with `text found` on the page it would
    // read as a shrug next to a measurement. So: it says what it read, and it
    // does not say whether that means the step was right — a QA engineer can
    // state text that is *meant* to have gone away, and only they know which.
    return (
      head +
      stated +
      observationList(s.observations) +
      `<p class="muted">Obsrv reports whether it found each text, not whether finding it means the step was correct.</p></div>`
    )
  }
  if (s.expect === undefined) {
    return head + `<p class="muted">Nothing was stated for this step.</p></div>`
  }
  // A stated sentence with no record behind it: nothing captured it as
  // checkable, so Obsrv shows what was asked and what it captured, side by
  // side, and the reader judges. A tool that answered "pass" here would be
  // answering a question nobody measured.
  return head + stated + `<p class="muted">Obsrv does not judge this. The screen and the reply are below, as it found them.</p></div>`
}

/** "Where this step ran", one click down.
 *
 *  It names what it is — *address, size and density* — because the clause this
 *  satisfies says "for reproduction", and a reader who took that to mean a DOM
 *  snapshot would find four facts and assume the rest was omitted rather than
 *  never collected. Absent fields are left out rather than shown as unknown: the
 *  runner copies only what `status` answered, so a gap is "not reported" and a
 *  row saying "density: unknown" would invent a measurement that was not taken. */
function pageStateBlock(p: FlowReportPageState | undefined): string {
  if (p === undefined) return ''
  const rows: string[] = []
  if (p.url !== undefined) rows.push(`<tr><td>Address</td><td><code>${escapeHtml(p.url)}</code></td></tr>`)
  if (p.cssWidth !== undefined && p.cssHeight !== undefined) {
    rows.push(`<tr><td>Size</td><td>${p.cssWidth} × ${p.cssHeight} CSS px</td></tr>`)
  }
  if (p.deviceScaleFactor !== undefined) rows.push(`<tr><td>Density</td><td>${p.deviceScaleFactor}×</td></tr>`)
  // Only worth a row when it is true. "Loading: no" on every settled step is
  // noise; a step that finished while the page was still loading is the case a
  // reproducer needs told, and `settled` in the half above is a different fact
  // — a page can stop painting with a fetch still in flight.
  if (p.loading === true) {
    rows.push(`<tr><td>Loading</td><td><b>the page was still loading when this step finished</b></td></tr>`)
  }
  if (rows.length === 0) return ''
  return (
    `<details><summary>Where this step ran — address, size and density</summary>` +
    `<table class="where">${rows.join('')}</table>` +
    `<p class="muted">The page as this step left it, for reopening it. Not a snapshot of the document's contents.</p></details>`
  )
}

/** What Obsrv understood a sentence to mean, directly under the step's heading
 *  and not one click down.
 *
 *  This is the line that separates *"Obsrv misunderstood step 2"* from *"step 2
 *  is broken"*, which is the whole reason a plain-language flow is safer than a
 *  click recording. Burying it in a `<details>` would leave a QA engineer
 *  reading a failed step with no way to tell which of those two happened
 *  without expanding something.
 *
 *  `keyedOn` is shown beside the clause rather than instead of it: the clause is
 *  what they wrote, and `keyedOn` is the part the rule actually matched, so a
 *  rule that fired on the wrong two words is visible. */
function resolvedFrom(s: FlowReportStep): string {
  if (s.clause === undefined) return ''
  const keyed =
    s.keyedOn !== undefined
      ? ` Obsrv read it as <b>${escapeHtml(s.keyedOn)}</b>.`
      : ''
  return `<p class="resolved">From your description: <q>${escapeHtml(s.clause)}</q>.${keyed}</p>`
}

/** "What this step asked the network for", one click down.
 *
 *  **Three states, not two**, and the third is the reason this function is longer
 *  than a `map`: a step with requests, a step with none, and a step whose record
 *  was never taken. The first two are ordinary; the third must not borrow the
 *  second's words. `stopped` is printed above the rows rather than below them,
 *  because a reader who sees the rows first has already formed the belief that
 *  the list is complete. */
function networkBlock(nw: FlowReportNetwork | undefined): string {
  if (nw === undefined) {
    return (
      `<details><summary>What this step asked the network for</summary>` +
      `<p class="muted">No record was taken for this step, so this is not "no requests" — it is nothing to say either way.</p></details>`
    )
  }
  const note =
    nw.stopped !== undefined
      ? `<p class="bad">Recording had stopped, so this is not every request: ${escapeHtml(nw.stopped)}</p>`
      : nw.dropped > 0
        ? `<p class="muted">${nw.dropped} more request${nw.dropped === 1 ? '' : 's'} past the first listed are not shown.</p>`
        : ''
  if (nw.records.length === 0) {
    const none =
      nw.stopped !== undefined
        ? '' // The sentence above already says why there is nothing here.
        : `<p class="muted">This step asked for nothing over the network.</p>`
    return `<details><summary>What this step asked the network for</summary>${note}${none}</details>`
  }
  const rows = nw.records
    .map(r => {
      // A request with no status was still in flight when the step ended. Said in
      // words rather than left blank: a blank cell reads as a missing field.
      const status = r.status === undefined ? '<span class="muted">in flight</span>' : String(r.status)
      const type = r.type !== undefined ? `<td class="muted">${escapeHtml(r.type)}</td>` : '<td></td>'
      return `<tr><td>${escapeHtml(r.method)}</td><td>${status}</td>${type}<td><code>${escapeHtml(r.url)}</code></td></tr>`
    })
    .join('')
  return (
    `<details><summary>What this step asked the network for (${nw.records.length})</summary>${note}` +
    `<table class="net"><thead><tr><th>Method</th><th>Status</th><th>Type</th><th>URL</th></tr></thead><tbody>${rows}</tbody></table></details>`
  )
}

function flowStepSection(s: FlowReportStep, n: number): string {
  const st = flowStepState(s)
  const where = s.target !== undefined ? ` <code>${escapeHtml(s.target)}</code>` : ''
  const shot = s.data !== undefined ? `<figure><img alt="step ${n}" src="data:image/png;base64,${s.data}"><figcaption>The pane as step ${n} left it.</figcaption></figure>` : ''
  const reply =
    s.reply !== undefined
      ? `<details><summary>The step's own reply, for reproduction</summary><pre>${escapeHtml(JSON.stringify(s.reply, null, 2))}</pre></details>`
      : ''
  const ranAt = pageStateBlock(s.page)
  return (
    `<div class="step" id="step-${n}"><h3>Step ${n} — <code>${escapeHtml(s.action)}</code>${where} <span class="state ${st.cls}">${st.label}</span></h3>` +
    resolvedFrom(s) +
    `<div class="halves">${measuredHalf(s)}${askedHalf(s)}</div>${shot}${ranAt}${networkBlock(s.network)}${reply}</div>`
  )
}

export function flowReportHtml(data: FlowReportData): string {
  // A link only when there is an address to link to. Without one the report says
  // what it drove in words, because an anchor whose href is a sentence is a
  // broken link dressed as a subject.
  const subject =
    data.url !== undefined && data.url.trim().length > 0
      ? `<a href="${escapeHtml(data.url)}">${escapeHtml(data.url)}</a>`
      : `<span class="muted">the page the app already had open — this flow never navigated</span>`
  const gap = flowCoverageNote(data.steps)
  // The front page leads with what was not covered. A QA engineer's costliest
  // mistake is trusting a clean report that never reached step 4, so the
  // sentence about coverage goes above the findings rather than under them —
  // and when there is nothing to say, it says so explicitly instead of being
  // silent, because silence here reads as a pass.
  const coverage =
    data.refused !== undefined
      ? `<p class="note gap"><b>The flow did not run.</b> ${escapeHtml(data.refused)}</p>`
      : data.steps.length === 0
        ? // A flow with no steps is not a clean flow. `flowCoverageNote` says
          // nothing for an empty list — correctly, since there is no coverage to
          // describe — and the all-clear below would then read as a pass for a
          // run that drove nothing at all. That is this card's own thesis
          // inverted, and it is what the sentence exists to prevent.
          `<p class="note gap"><b>This flow had no steps.</b> Nothing was driven and nothing was measured, so there is nothing below — an empty result here is the flow being empty, not the page being clean.</p>`
        : gap !== null
          ? `<p class="note gap"><b>This report does not cover the whole flow.</b> ${escapeHtml(gap)}.</p>`
          : `<p class="note">Every step was attempted, and every step's evidence was measured on a page that had stopped painting.</p>`
  const rows = data.steps
    .map((s, i) => {
      const st = flowStepState(s)
      return `<tr><td class="n">${i + 1}</td><td><code>${escapeHtml(s.action)}</code></td><td>${s.target ? `<code>${escapeHtml(s.target)}</code>` : '<span class="muted">—</span>'}</td><td><span class="state ${st.cls}">${st.label}</span></td></tr>`
    })
    .join('')
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>Obsrv flow report${data.url !== undefined && data.url.trim().length > 0 ? ` — ${escapeHtml(data.url)}` : ''}</title>\n<style>${CSS}</style>\n</head>\n<body>\n<main>\n` +
    `<h1>Obsrv flow report</h1>\n<p class="facts">${subject}<br>${escapeHtml(data.generatedAt)} · obsrv ${escapeHtml(data.version)}</p>\n` +
    coverage +
    `\n<h2>The steps</h2>\n<table><thead><tr><th class="n">#</th><th>Action</th><th>Target</th><th>State</th></tr></thead><tbody>${rows}</tbody></table>\n` +
    data.steps.map((s, i) => flowStepSection(s, i + 1)).join('\n') +
    `\n<footer>Every step is listed, including the ones the flow never reached. A step marked <span class="state unknown">unknown</span> ` +
    `was measured while the page was still painting, or could not be checked — its evidence is not a clean result. ` +
    `Obsrv reports what it observed and does not judge a stated expectation. ` +
    // Named rather than silent. "What Obsrv measured" is a heading a reader can
    // reasonably take to include the audit and lint findings the rest of Obsrv
    // produces, and per step it does not: the runner records no per-step
    // passive findings, so there is nothing to separate the stated texts from
    // yet. Leaving the heading to imply otherwise is the failure this document
    // exists to avoid.
    `Obsrv's own passive findings — contrast, tap sizes, text size, the audit and lint rules — are <b>not</b> collected per step yet, ` +
    `so "what Obsrv measured" here means the page's settle state and this step's own reply, not a visual review of each screen. ` +
    `Run <code>obsrv audit</code> or <code>obsrv lint</code> for those. ` +
    `Generated by obsrv ${escapeHtml(data.version)}.</footer>\n` +
    `</main>\n</body>\n</html>\n`
  )
}
