import type { AuditResult, AuditThresholds } from './audit'
import type { UnsettledReason } from './capture'
import { formatTextScale } from '../shared/textScale'
import type { DiffMetrics } from './metrics'

/**
 * The report page: one self-contained HTML file — inline CSS, inline PNGs,
 * no script, nothing fetched — so it can be attached to a PR, mailed, or
 * opened from a folder in a year. Pure: a data object in, a string out, and
 * unit-tested that way. Everything that came from the page under test goes
 * through `escapeHtml`; an element's text is the page's, not ours.
 */

export interface ReportImage {
  /** PNG bytes, base64. */
  base64: string
  width: number
  height: number
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
 * The full-page render with the worst findings located on it: an overview
 * image, pins in page-fraction coordinates, and a crop of each. Present only
 * when the screen has findings to show. `belowCapture` counts findings past
 * the captured height (a page taller than the device-pixel capture cap).
 */
export interface ReportProblems {
  overview: ReportImage
  features: ReportProblemFeature[]
  belowCapture: number
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
  /** Null when the page did not answer the audit. */
  audit: AuditResult | null
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
  /** The network and CPU conditions every screen was rendered under, when `--throttle` was given. */
  throttle?: { id: string; label: string; summary: string }
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
const mm = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v.toFixed(1)} mm`)
const num = (v: number, places = 1): string => v.toFixed(places)

const CSS = `
:root { color-scheme: light dark; --ink: #1a1a1a; --muted: #666; --line: #d9d9d9; --paper: #fff; --panel: #f6f6f6; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --ink: #ececec; --muted: #9a9a9a; --line: #333; --paper: #141414; --panel: #1e1e1e; --bad: #ff7b6e; } }
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
.overview img { max-height: 900px; }
.pin { position: absolute; transform: translate(-50%, -50%); min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: var(--bad); color: #fff; font: 700 12px/22px -apple-system, sans-serif; text-align: center; border: 2px solid var(--paper); box-shadow: 0 0 0 1px var(--bad); }
.crops { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-top: 14px; }
.crop { border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.crop img { display: block; max-width: 100%; max-height: 260px; width: auto; border: 0; }
.crop figcaption { margin: 0; padding: 6px 8px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); }
.crop figcaption b { color: var(--bad); }
`

function auditSection(s: ReportScreen, thresholds: AuditThresholds): string {
  if (!s.audit) return `<h3>Audit</h3><p class="note">The page did not answer the audit (it may have navigated away, or thrown while being measured).</p>`
  const a = s.audit
  const t = a.summary.targets
  const x = a.summary.text
  const under = (n: number | null): string => (n === null ? '—' : n === 0 ? '0' : `<span class="bad">${n}</span>`)
  const rows = a.findings
    .map(
      f =>
        `<tr><td><span class="kind">${f.kind === 'small-target' ? 'target' : 'text'}</span></td>` +
        `<td><code>${escapeHtml(f.element)}</code></td><td>${escapeHtml(f.text)}</td>` +
        `<td class="n">${f.kind === 'small-target' ? `${num(f.cssWidth, 0)}×${num(f.cssHeight, 0)} px` : `${num(f.fontSizePx, 0)} px`}</td>` +
        `<td class="n bad">${num(f.mm, 2)} mm</td></tr>`,
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
      ? `<table style="margin-top:12px"><tr><th></th><th>Element</th><th>Text</th><th class="n">CSS</th><th class="n">On this screen</th></tr>${rows}</table>`
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
        `<figure class="crop"><img src="data:image/png;base64,${f.crop.base64}" alt="Finding ${f.n}: ${escapeHtml(f.element)}">` +
        `<figcaption><b>${f.n}</b> <code>${escapeHtml(f.element)}</code> · ${escapeHtml(f.detail)}</figcaption></figure>`,
    )
    .join('')
  const below =
    p.belowCapture > 0
      ? `<p class="muted">${p.belowCapture} more finding(s) sit below the captured area — the page is taller than the capture can reach on this screen.</p>`
      : ''
  const many = p.features.length === 1 ? 'the smallest finding, located on the page' : `the ${p.features.length} smallest findings, located on the page`
  return (
    `<h3>Where the problems are — ${many}</h3>` +
    `<div class="overview"><img src="data:image/png;base64,${p.overview.base64}" alt="The full page, with the worst findings marked">${pins}</div>` +
    `<div class="crops">${crops}</div>` +
    below
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
  return (
    `<h3>1x vs 2x — this screen against the one it was designed on</h3>` +
    `<div class="pair">` +
    `<figure><img src="data:image/png;base64,${target.base64}" alt="This screen"><figcaption>This screen, 1x, ${target.width}×${target.height} device px${unprofiled}</figcaption></figure>` +
    `<figure><img src="data:image/png;base64,${s.diff.reference.base64}" alt="2x reference"><figcaption>2x reference, box-downsampled to the same grid</figcaption></figure>` +
    `</div>` +
    `<table style="margin-top:12px"><tr><th></th><th class="n">This screen</th><th class="n">Reference</th><th class="n">Delta</th></tr>` +
    `<tr><td>Ink coverage</td><td class="n">${pct(m.inkCoverage.target)}</td><td class="n">${pct(m.inkCoverage.reference)}</td><td class="n${m.inkCoverage.delta < 0 ? ' bad' : ''}">${pct(m.inkCoverage.delta)}</td></tr>` +
    `<tr><td>Ink rows (ratio ≈0.5 is normal scaling)</td><td class="n">${m.rows.target}</td><td class="n">${m.rows.reference}</td><td class="n">${ratio}</td></tr></table>` +
    (m.findings.length > 0 ? `<ul class="plain">${m.findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : `<p class="muted">No band findings.</p>`) +
    (m.settled ? '' : `<p class="note">Unsettled: the page kept painting, so the deltas are frame-to-frame noise, not rendering evidence.</p>`)
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
    `${s.settled ? '' : ' · <span class="bad">not settled</span>'}</p>` +
    // The screen's own figure: always for a screen with no comparison, and
    // for a compared screen only when the profile made it a different image
    // from the one the comparison shows.
    (s.diff && s.diff.target === null
      ? ''
      : `<figure><img src="data:image/png;base64,${s.png.base64}" alt="${escapeHtml(s.label)}"><figcaption>Shown scaled to fit; ${s.png.width}×${s.png.height} device px on a screen ${physical}${s.diff ? ', through the panel profile' : ''}.</figcaption></figure>`) +
    problemsSection(s) +
    diffSection(s) +
    auditSection(s, thresholds) +
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
    `${data.throttle ? `throttle <b>${escapeHtml(data.throttle.label)}</b> (${escapeHtml(data.throttle.summary)}) · ` : ''}` +
    `${escapeHtml(data.generatedAt)} · obsrv ${escapeHtml(data.version)}</p>\n` +
    `<p>The same page on the screens people own. Each render is at the screen's true density; the audit measures ` +
    `tap targets and text in millimetres on that screen; 1x screens are compared with the 2x display the page was ` +
    `probably designed on.</p>\n<p class="muted">${nav}</p>\n` +
    data.screens.map(s => screenSection(s, data.thresholds)).join('\n') +
    `\n<footer>Thresholds are provisional and stated above; findings are informational. Images are shown scaled to fit — ` +
    `open the PNGs at 1:1, or the page in Obsrv, for the actual pixels. Generated by obsrv ${escapeHtml(data.version)}.</footer>\n` +
    `</main>\n</body>\n</html>\n`
  )
}
