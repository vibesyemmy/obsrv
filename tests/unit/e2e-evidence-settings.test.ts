import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import config from '../../playwright.config'

/**
 * The e2e suite keeps its failure evidence (bug-trace-setting-has-no-guard).
 *
 * For a week `playwright.config.ts` set no `trace` and no `screenshot`, so a
 * failing run left `error-context.md` and nothing else. CI's step named "Upload
 * Playwright traces on failure" uploaded that directory and passed. Its
 * `if-no-files-found: error` could not notice: the directory was never empty
 * (71 failure attempts, not one). So the settings are checked where they are
 * set, together with what they depend on. A trace taken only on a retry is
 * never written in a run that does not retry.
 *
 * Not `video`: #29 chose the trace and a screenshot as the evidence and left
 * video off. This guards that choice, not one it didn't make.
 */

const ROOT = resolve(__dirname, '../..')
/** Trace modes that leave a trace behind for a failed test. */
const RECORDS_ON_FAILURE = ['on', 'retain-on-failure', 'retain-on-first-failure', 'on-first-retry', 'on-all-retries']
/** Of those, the ones that only record on a retry. */
const ONLY_ON_A_RETRY = ['on-first-retry', 'on-all-retries']
/** Screenshot modes that write a picture of a failed test. */
const SHOTS_ON_FAILURE = ['on', 'only-on-failure', 'on-first-failure']

type Use = { trace?: unknown; screenshot?: unknown }
const mode = (v: unknown): string | undefined => (typeof v === 'string' ? v : ((v as { mode?: string } | undefined)?.mode ?? undefined))

/** Each project's effective `use`: its own settings over the top level's. A config without projects is one project. */
function effectiveUses(): { name: string; use: Use }[] {
  const top = (config.use ?? {}) as Use
  const projects = config.projects ?? []
  if (projects.length === 0) return [{ name: '(the config)', use: top }]
  return projects.map(p => ({ name: p.name ?? '(unnamed project)', use: { ...top, ...((p.use ?? {}) as Use) } }))
}

/**
 * Every `playwright test` invocation in CI, with the flags that override the
 * config. Shell continuations are joined first: a `--trace off` on the line
 * after a trailing backslash is the same command, and a line-based scan missed
 * it (Kenya's read of #137, measured). A YAML folded scalar (`run: >`) is not
 * joined; ci.yml uses none.
 */
function ciInvocations(): { line: string; retries: number | undefined; trace: string | undefined }[] {
  const yml = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8').replace(/\\\n\s*/g, ' ')
  return yml
    .split('\n')
    .filter(l => /\bplaywright test\b/.test(l) && !l.trim().startsWith('#'))
    .map(line => {
      const r = line.match(/--retries[= ](\d+)/)
      const t = line.match(/--trace[= ]([\w-]+)/)
      return { line: line.trim(), retries: r ? Number(r[1]) : undefined, trace: t?.[1] }
    })
}

describe('the e2e suite keeps its failure evidence', () => {
  it('records a trace of a failed test in every project', () => {
    for (const { name, use } of effectiveUses()) {
      expect(RECORDS_ON_FAILURE, `${name}: trace is ${JSON.stringify(use.trace)}`).toContain(mode(use.trace))
    }
  })

  it('writes a screenshot of a failed test in every project, since the Electron trace carries no picture', () => {
    for (const { name, use } of effectiveUses()) {
      expect(SHOTS_ON_FAILURE, `${name}: screenshot is ${JSON.stringify(use.screenshot)}`).toContain(mode(use.screenshot))
    }
  })

  it('retries wherever the trace is taken only on a retry, in the config and in every CI invocation', () => {
    const invocations = ciInvocations()
    // Not vacuous: CI does run the suite, and this found where.
    expect(invocations.length).toBeGreaterThan(0)
    for (const { name, use } of effectiveUses()) {
      if (!ONLY_ON_A_RETRY.includes(mode(use.trace) ?? '')) continue
      expect(config.retries ?? 0, `${name}: trace ${mode(use.trace)} records nothing with retries ${config.retries ?? 0}`).toBeGreaterThanOrEqual(1)
      for (const inv of invocations) {
        const retries = inv.retries ?? config.retries ?? 0
        expect(retries, `CI runs "${inv.line}", which retries ${retries} times, so trace ${mode(use.trace)} records nothing`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('is not switched off from the command line in CI', () => {
    for (const inv of ciInvocations()) {
      if (inv.trace !== undefined) expect(RECORDS_ON_FAILURE, `CI runs "${inv.line}"`).toContain(inv.trace)
    }
  })
})
