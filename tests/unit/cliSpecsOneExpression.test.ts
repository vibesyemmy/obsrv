import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

/**
 * `chore-desk-safe-run-says-what-it-left-out`'s named trap: the exclusion
 * (`playwright.config.ts`'s `testIgnore`) and the announcement of it
 * (`cliSpecsAnnounce.ts`) must read ONE function's answer, not two
 * hand-written copies of "CI or opted in" — the shape of the
 * `MAX_TRIES`/timeout mistake made earlier the same evening, where two
 * expressions that were supposed to agree were free to drift apart because
 * nothing checked that they were the same expression rather than two that
 * currently computed the same thing.
 *
 * This reads the SOURCE of both consumers rather than trusting that they
 * agree today: two copies that happen to match right now are still the
 * defect, waiting for one of them to be edited without the other. It would
 * pass just as happily if both hand-wrote the identical condition — which is
 * exactly what it must not accept, so it asserts the import, not merely
 * that the files mention the right env vars.
 */
describe('the CLI-spec exclusion and its announcement share one expression', () => {
  const gate = readFileSync(join(ROOT, 'tests', 'e2e', 'cliSpecsGate.ts'), 'utf8')
  const config = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8')
  const announce = readFileSync(join(ROOT, 'tests', 'e2e', 'cliSpecsAnnounce.ts'), 'utf8')

  it('playwright.config.ts imports cliSpecsExcluded and calls it, rather than re-deriving it', () => {
    expect(config).toMatch(/import\s*\{\s*cliSpecsExcluded\s*\}\s*from\s*['"]\.\/tests\/e2e\/cliSpecsGate['"]/)
    expect(config).toMatch(/cliSpecsExcluded\(/)
  })

  it('cliSpecsAnnounce.ts imports cliSpecsExcluded from the same module, rather than its own copy', () => {
    expect(announce).toMatch(/import\s*\{\s*cliSpecsExcluded\s*\}\s*from\s*['"]\.\/cliSpecsGate['"]/)
    expect(announce).toMatch(/cliSpecsExcluded\(/)
  })

  it('OBSRV_E2E_CLI is read in exactly one place, and it is the shared module', () => {
    // Bracket-indexed by the literal key, not tied to the receiver's name
    // (`env['OBSRV_E2E_CLI']`, `process.env['OBSRV_E2E_CLI']`, …), so a
    // rewrite that renames the parameter still counts as the same read.
    // OBSRV_E2E_CLI has no purpose in this file set other than this decision
    // (unlike CI, which playwright.config.ts also reads for its reporter
    // choice — a different, legitimate question this test does not police),
    // so a second read of it anywhere is a second, independently-authored
    // copy of the condition — even one that currently agrees with
    // cliSpecsGate.ts. Agreement today is not the guarantee this checks for.
    const optInReads = (s: string): number => (s.match(/\[['"]OBSRV_E2E_CLI['"]\]/g) ?? []).length
    expect(optInReads(gate)).toBe(1)
    expect(optInReads(config)).toBe(0)
    expect(optInReads(announce)).toBe(0)
  })
})
