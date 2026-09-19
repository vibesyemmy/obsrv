import { cliSpecsExcluded } from './cliSpecsGate'

/**
 * The line a local run prints once when it has left the CLI-launch specs
 * out (`chore-desk-safe-run-says-what-it-left-out`).
 *
 * The exclusion is silent by construction: an *ignored* spec is never
 * collected, so it has no chance to explain itself, and a full run's count
 * is simply smaller than someone comparing against CI would expect, with
 * nothing saying why. That is a silence fitting two facts — "the suite
 * passed" and "the suite passed the part of it you ran" — the same shape
 * this team spent a week removing from the product, now in the tooling.
 */
export const EXCLUSION_LINE = 'CLI specs excluded; OBSRV_E2E_CLI=1 to include them'

/**
 * Exported separately from the Playwright entry point below so a unit test
 * can drive it with an injected env and a captured log, without booting
 * anything. `cliSpecsExcluded` is the only thing this reads to decide.
 */
export function announceIfExcluded(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.log): void {
  if (cliSpecsExcluded(env)) log(EXCLUSION_LINE)
}

/**
 * Playwright's `globalSetup` entry point: required once, before any test
 * runs, regardless of worker count (`playwright.config.ts:workers` is 1
 * here anyway, but `globalSetup` itself runs once even when it is not).
 */
export default function globalSetup(): void {
  announceIfExcluded()
}
