import { describe, expect, it } from 'vitest'
import { escapeHtml, reportHtml, type ReportData, type ReportScreen } from '../../src/cli/reportHtml'

const png = { base64: 'iVBORw0KGgo=', width: 1366, height: 768 }

const screen = (over: Partial<ReportScreen> = {}): ReportScreen => ({
  presetId: 'laptop-768',
  label: '1366×768 15.6"',
  cssWidth: 1366,
  cssHeight: 768,
  deviceScaleFactor: 1,
  textScale: 1,
  diagonalInches: 15.6,
  ppi: 100.4,
  physicalMm: { width: 345.5, height: 194.2 },
  orientation: 'landscape',
  png,
  settled: true,
  audit: {
    ppi: 100.4,
    thresholds: { tapMm: 7, textMm: 2 },
    summary: {
      targets: { count: 2, under: 1, smallestPx: 24, smallestMm: 6.07 },
      text: { count: 6, under: 0, smallestPx: 10, smallestMm: 2.53 },
    },
    findings: [
      {
        kind: 'small-target',
        element: 'button#tiny',
        text: '<script>alert("x")</script> & "quotes"',
        rect: { x: 16, y: 76, width: 24, height: 24 },
        cssWidth: 24,
        cssHeight: 24,
        mm: 6.07,
      },
    ],
    truncated: { findings: 3, targets: 0, text: 0 },
    warnings: [],
  },
  lint: null,
  diff: {
    metrics: {
      settled: true,
      inkCoverage: { target: 0.031, reference: 0.034, delta: -0.003 },
      rows: { target: 120, reference: 240, ratio: 0.5 },
      bands: [],
      findings: ['band 3: hairline lost at 1x'],
    },
    target: null,
    reference: { base64: 'AAAA', width: 1366, height: 768 },
  },
  diffSkipped: null,
  warnings: ['warning: something <odd>'],
  ...over,
})

const data = (screens: ReportScreen[]): ReportData => ({
  url: 'https://example.test/a?b=1&c=<2>',
  generatedAt: '2026-09-02T18:00:00.000Z',
  version: '0.21.0',
  profile: { id: 'budget-tn', label: 'Budget TN' },
  thresholds: { tapMm: 7, textMm: 2 },
  screens,
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})

describe('reportHtml', () => {
  it('is one self-contained document: inline images, inline style, no script, nothing fetched', () => {
    const html = reportHtml(data([screen()]))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<link /i)
    expect(html).not.toMatch(/src="https?:/i)
    expect((html.match(/src="data:image\/png;base64,/g) ?? []).length).toBe(2)
  })
  it('escapes everything the page supplied: element text, warnings, the URL', () => {
    const html = reportHtml(data([screen()]))
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;')
    expect(html).toContain('warning: something &lt;odd&gt;')
    expect(html).toContain('https://example.test/a?b=1&amp;c=&lt;2&gt;')
    expect(html).toContain('<title>Obsrv report — https://example.test/a?b=1&amp;c=&lt;2&gt;</title>')
  })
  it('states the screen, the profile and the thresholds, and shows the figures', () => {
    const html = reportHtml(data([screen()]))
    expect(html).toContain('1366×768 15.6&quot;')
    expect(html).toContain('Budget TN')
    expect(html).toContain('7 mm targets, 2 mm text')
    expect(html).toContain('346×194 mm')
    expect(html).toContain('100 ppi')
    expect(html).toContain('button#tiny')
    expect(html).toContain('6.07 mm')
    expect(html).toContain('3 more finding(s) not listed')
    expect(html).toContain('3.10%')
    expect(html).toContain('band 3: hairline lost at 1x')
    expect(html).toContain('obsrv 0.21.0')
  })
  it('locates the worst findings: a full-page overview with a numbered pin and a crop for each', () => {
    const withProblems = screen({
      problems: {
        overview: { base64: 'T1ZFUlZJRVc=', width: 400, height: 1200 },
        features: [
          { n: 1, xFrac: 0.5, yFrac: 0.0625, crop: { base64: 'Q1JPUDE=', width: 56, height: 56 }, element: 'button#tiny', detail: '24×24 px · 6.07 mm' },
          { n: 2, xFrac: 0.1, yFrac: 0.4, crop: { base64: 'Q1JPUDI=', width: 120, height: 40 }, element: 'p#caption', detail: '10 px · 1.90 mm' },
        ],
        belowCapture: 5,
      },
    })
    const html = reportHtml(data([withProblems]))
    expect(html).toContain('Where the problems are')
    // The overview image and both crops are present.
    expect(html).toContain('data:image/png;base64,T1ZFUlZJRVc=')
    expect(html).toContain('data:image/png;base64,Q1JPUDE=')
    expect(html).toContain('data:image/png;base64,Q1JPUDI=')
    // Pins placed by page fraction, matching the crops.
    expect(html).toContain('class="pin"')
    expect(html).toContain('top:6.25%')
    expect(html).toContain('left:50.00%')
    // Captions carry the element and the measurement.
    expect(html).toContain('p#caption')
    expect(html).toContain('10 px · 1.90 mm')
    // The ones past the captured height are counted, not silently dropped.
    expect(html).toContain('5 more finding(s) sit below the captured area')
  })

  it('renders the lint as grouped rows with an exemplar, and says when the page did not answer', () => {
    const finding = {
      rule: 'contrast' as const,
      element: 'span.rank',
      text: '1.',
      rect: { x: 10, y: 20, width: 30, height: 14 },
      message: '#828282 on #f6f6ef is 3.54:1 as stated; WCAG AA asks 4.5:1 of text this size',
      fontSizePx: 13,
      fontWeight: 400,
      color: '#828282',
      background: '#f6f6ef',
      asIs: 3.54,
      onPanel: 3.1,
      threshold: 4.5,
      largeText: false,
    }
    const withLint = screen({
      lint: {
        profile: 'budget-tn',
        thresholds: { thinPx: 14 },
        summary: { hairline: 0, 'thin-text': 0, contrast: 270, 'contrast-on-panel': 10, 'image-upscaled': 0, 'image-oversized': 0 },
        findings: [finding],
        groups: [{ rule: 'contrast', key: '#828282 on #f6f6ef', count: 270, exemplar: finding, elements: ['span.rank', 'span.sitebit', 'span.sitestr'] }],
        skipped: { textOnImages: 3 },
        truncated: { findings: 70, text: 0, edges: 0, images: 0 },
        warnings: ['70 more findings past the 200 listed; the summary counts them all'],
      },
    })
    const html = reportHtml(data([withLint]))
    expect(html).toContain('Lint — what this screen and its panel break')
    expect(html).toContain('<span class="bad">270</span>')
    expect(html).toContain('#828282 on #f6f6ef')
    expect(html).toContain('and 269 more')
    expect(html).toContain('3 text element(s) sit on an image')
    expect(html).toContain('70 more findings past the 200 listed')
    expect(reportHtml(data([screen({ lint: null })]))).toContain('The page did not answer the lint')
  })

  it('an image that says it is a JPEG is embedded as one; the rest default to PNG', () => {
    const withJpeg = screen({
      problems: {
        overview: { base64: 'SlBFRw==', width: 400, height: 1200, mime: 'image/jpeg' },
        features: [{ n: 1, xFrac: 0.5, yFrac: 0.1, crop: { base64: 'Q1JPUA==', width: 40, height: 40 }, element: 'button#tiny', detail: '24×24 px · 6.07 mm' }],
        belowCapture: 0,
      },
    })
    const html = reportHtml(data([withJpeg]))
    expect(html).toContain('data:image/jpeg;base64,SlBFRw==')
    expect(html).toContain('data:image/png;base64,Q1JPUA==')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
  })

  it('no problems block when there is nothing to feature', () => {
    const html = reportHtml(data([screen({ problems: undefined })]))
    expect(html).not.toContain('Where the problems are')
    expect(html).not.toContain('class="pin"')
  })

  it('a dense screen shows its render and says why there is no diff; an unsettled one is flagged', () => {
    const phone = screen({
      presetId: 'android-65',
      label: 'Budget Android 6.5" @2x',
      deviceScaleFactor: 2,
      diff: null,
      diffSkipped: 'a dense screen has no 1x-vs-2x comparison',
      settled: false,
      png: { base64: 'BBBB', width: 720, height: 1600 },
    })
    const html = reportHtml(data([phone]))
    expect(html).toContain('No comparison: a dense screen has no 1x-vs-2x comparison')
    expect(html).toContain('data:image/png;base64,BBBB')
    expect(html).toContain('not settled')
    expect(html).toContain('at <b>2x</b>')
  })
  it('with a panel profile, a compared screen shows its profiled render and the unprofiled pair it was measured on', () => {
    const s = screen()
    const html = reportHtml(data([{ ...s, diff: { ...s.diff!, target: { base64: 'RAW1', width: 1366, height: 768 } } }]))
    expect((html.match(/src="data:image\/png;base64,/g) ?? []).length).toBe(3)
    expect(html).toContain('data:image/png;base64,RAW1')
    expect(html).toContain('through the panel profile')
    expect(html).toContain('without the panel profile')
  })
  it('states a text scale in the facts, and only when one is in force', () => {
    expect(reportHtml(data([screen()]))).not.toContain('text <b>')
    expect(reportHtml(data([screen({ textScale: 1.5 })]))).toContain('· text <b>150%</b>')
  })
  it('states the throttle and each screen’s time to paint-quiet when a throttle was named', () => {
    const plain = reportHtml(data([screen()]))
    expect(plain).not.toContain('settled in')
    expect(plain).not.toContain('throttle <b>')
    const d = data([screen({ settledMs: 812 }), screen({ presetId: 'android-65', settledMs: null, settled: false })])
    const html = reportHtml({ ...d, throttle: { id: 'budget-phone', label: 'Budget phone', summary: '3G and CPU 6×' } })
    expect(html).toContain('throttle <b>Budget phone</b> (3G and CPU 6×)')
    expect(html).toContain('settled in <b>0.8 s</b>')
    expect(html).toContain('never settled')
  })
  it('says when the page did not answer the audit', () => {
    const html = reportHtml(data([screen({ audit: null })]))
    expect(html).toContain('did not answer the audit')
  })
  it('links each screen from a nav line', () => {
    const html = reportHtml(data([screen(), screen({ presetId: 'iphone-61', label: 'iPhone 6.1" @3x' })]))
    expect(html).toContain('href="#laptop-768"')
    expect(html).toContain('href="#iphone-61"')
    expect(html).toContain('<section id="iphone-61">')
  })
})
