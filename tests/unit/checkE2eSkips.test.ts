import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** scripts/check-e2e-skips.js, driven with report shapes Playwright's JSON reporter writes (bug-ci-skips-are-unlisted). */
const check = createRequire(__filename)('../../scripts/check-e2e-skips.js') as {
  skippedTests(report: unknown): { file: string; title: string; line: number; why: string }[]
  main(reportPath: string, listPath: string): string
}

const spec = (title: string, status: string, why?: string) => ({
  title,
  file: 'live-drive.spec.ts',
  line: 349,
  tests: [{ status, annotations: why === undefined ? [] : [{ type: 'skip', description: why }] }],
})
const report = (specs: unknown[], stats: Record<string, number>) => ({
  stats,
  suites: [{ title: 'live-drive.spec.ts', file: 'live-drive.spec.ts', specs, suites: [{ title: 'a describe', file: 'live-drive.spec.ts', specs: [spec('nested', 'expected')], suites: [] }] }],
})

function run(r: unknown, skips: unknown[]): () => string {
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-skips-'))
  const reportPath = join(dir, 'results.json')
  const listPath = join(dir, 'skips.json')
  writeFileSync(reportPath, JSON.stringify(r))
  writeFileSync(listPath, JSON.stringify({ skips }))
  return () => {
    try {
      return check.main(reportPath, listPath)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

describe('check-e2e-skips', () => {
  const FOCUS = 'focusWindow answers ok and fronts the window'
  const RUNNER = 'the runner did not grant window focus'

  it("names an unlisted skip: file, line, title and the test's own reason (#141's first head)", () => {
    const r = report([spec(FOCUS, 'skipped', RUNNER), spec('another', 'expected')], { expected: 2, skipped: 1 })
    expect(run(r, [])).toThrow(`skipped and not listed: live-drive.spec.ts:349 › ${FOCUS} (its reason: "${RUNNER}")`)
  })

  it('passes a run whose skips are exactly the listed ones', () => {
    const r = report([spec(FOCUS, 'skipped', RUNNER)], { expected: 1, skipped: 1 })
    expect(run(r, [{ file: 'live-drive.spec.ts', title: FOCUS, why: 'measured reason' }])()).toBe('2 tests; 1 skipped, all listed')
  })

  it('fails a listed row whose test ran: a reason nobody checks any more', () => {
    const r = report([spec(FOCUS, 'expected')], { expected: 2 })
    expect(run(r, [{ file: 'live-drive.spec.ts', title: FOCUS, why: 'old reason' }])).toThrow(`listed but not skipped: live-drive.spec.ts › ${FOCUS}`)
  })

  it('fails loudly on a report that accounts for no tests, or one that is not there', () => {
    expect(run({ stats: {}, suites: [] }, [])).toThrow('accounts for no tests at all')
    expect(() => check.main(join(tmpdir(), `obsrv-no-report-${process.pid}.json`), 'x.json')).toThrow('cannot read the e2e report')
  })

  it("fails when walking the report finds fewer skips than the report's own count: a shape it cannot read", () => {
    const r = { stats: { expected: 3, skipped: 1 }, suites: [{ title: 'x.spec.ts', file: 'x.spec.ts', entries: [spec(FOCUS, 'skipped', RUNNER)] }] }
    expect(run(r, [])).toThrow('counts 1 skipped test(s) but walking its suites found 0')
  })

  it('names a test that failed and then skipped on its retry, which Playwright reports as flaky', () => {
    const flaky = { ...spec(FOCUS, 'flaky'), tests: [{ status: 'flaky', annotations: [], results: [{ status: 'failed' }, { status: 'skipped', annotations: [{ type: 'skip', description: RUNNER }] }] }] }
    const r = report([flaky], { expected: 1, flaky: 1 })
    expect(run(r, [])).toThrow(`skipped on a retry and not listed: live-drive.spec.ts:349 › ${FOCUS} (its reason: "${RUNNER}")`)
  })

  it("reads a skip's reason from the result when the test itself carries none", () => {
    const onResult = { ...spec(FOCUS, 'skipped'), tests: [{ status: 'skipped', annotations: [], results: [{ status: 'skipped', annotations: [{ type: 'skip', description: RUNNER }] }] }] }
    expect(check.skippedTests(report([onResult], { skipped: 1 }))[0]?.why).toBe(RUNNER)
  })

  it('keys a nested test by its describe titles, as the list reporter prints them', () => {
    const r = { stats: { skipped: 1 }, suites: [{ title: 'x.spec.ts', file: 'x.spec.ts', specs: [], suites: [{ title: 'outer', file: 'x.spec.ts', specs: [{ ...spec('inner', 'skipped', 'r'), file: 'x.spec.ts' }], suites: [] }] }] }
    expect(check.skippedTests(r).map(s => s.title)).toEqual(['outer › inner'])
  })
})
