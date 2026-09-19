/**
 * Whether a run excludes the CLI-launch spec family
 * (`bug-cli-specs-have-no-gate-of-their-own`).
 *
 * The ONE place this is decided. `playwright.config.ts`'s `testIgnore` and
 * `cliSpecsAnnounce.ts`'s printed line both call this rather than each
 * re-deriving "CI or opted in" from `process.env` — two hand-written copies
 * of the same condition is exactly the shape of the `MAX_TRIES`/timeout
 * mistake made earlier the same evening (`chore-desk-safe-run-says-what-it-left-out`):
 * they agree today and are a single edit away from silently not agreeing.
 *
 * An `env` parameter, not a bare read of `process.env`, so both the
 * behaviour and its tests can be driven without mutating global state.
 */
export function cliSpecsExcluded(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['CI'] === undefined && env['OBSRV_E2E_CLI'] !== '1'
}
