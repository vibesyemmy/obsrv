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
