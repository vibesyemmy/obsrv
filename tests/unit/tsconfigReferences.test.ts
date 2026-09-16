import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every TypeScript project in this repo is reachable from the root, and the
 * typecheck command is the one that follows them.
 *
 * `tsconfig.json` is a solution root: `files: []` and no `include` means it
 * checks **zero files**, so `tsc --noEmit -p tsconfig.json` exits 0 having done
 * nothing. That is not a misconfiguration — it is what a solution root is — but
 * it is the obvious command to type, and it passed over a missing import that
 * then failed 46 unit tests (`bug-root-tsconfig-passes-vacuously`).
 *
 * **It cannot be made to refuse**: `files: []` and `include: []` were both
 * measured, and both exit 0 with no output. So the fix is that the command
 * which does work — `tsc --build`, which follows `references` — is *complete*,
 * and this test is what keeps it complete. `tsconfig.mcp.json` and
 * `tsconfig.tests.json` were missing from `references`, so errors in
 * `src/mcp/**` and `tests/**` were invisible to it.
 */

const ROOT = resolve(__dirname, '../..')
/** Comments are legal in tsconfig, and the root carries them; strip whole-line ones. */
const readJsonc = (file: string): unknown =>
  JSON.parse(
    readFileSync(resolve(ROOT, file), 'utf8')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n'),
  )

const projectFiles = (): string[] =>
  readdirSync(ROOT).filter(f => /^tsconfig\..+\.json$/.test(f)).sort()

describe('the root tsconfig reaches every project', () => {
  it('references every tsconfig.*.json in the repo', () => {
    const root = readJsonc('tsconfig.json') as { references?: { path: string }[] }
    const referenced = (root.references ?? []).map(r => r.path.replace(/^\.\//, '')).sort()
    const projects = projectFiles()
    // Not vacuous: there are projects to find, and this fails if the glob ever
    // stops matching rather than reporting an empty agreement.
    expect(projects.length, 'no tsconfig.*.json found at all').toBeGreaterThan(1)
    expect(referenced).toEqual(projects)
  })

  it('checks nothing itself, which is why the references have to be complete', () => {
    // If someone gives the root an `include`, the reasoning above stops holding
    // — the root would then check files under one set of compiler options, and
    // `tsconfig.mcp.json`'s deliberate lack of a DOM lib would stop meaning
    // anything. That is a decision to take deliberately, not to drift into.
    const root = readJsonc('tsconfig.json') as { files?: unknown[]; include?: unknown[] }
    expect(root.files, 'the root should list no files of its own').toEqual([])
    expect(root.include, 'the root should have no include').toBeUndefined()
  })

  it('is what `npm run typecheck` actually runs, so the two cannot drift', () => {
    const pkg = readJsonc('package.json') as { scripts?: Record<string, string> }
    const script = pkg.scripts?.typecheck ?? ''
    // `--build` is the part that matters: `-p` on this root checks nothing.
    expect(script, `typecheck is "${script}"`).toMatch(/tsc\s+--build\s+tsconfig\.json/)
    // `--noEmit` is not tidiness. `tsconfig.mcp.json` has an `outDir` and no
    // `noEmit` of its own, because `build:mcp` needs to emit — so without this
    // flag a command named "typecheck" REWRITES out/mcp/server.js, the very
    // file a dev lane and `publicShape.test` spawn (measured: a planted 2020
    // mtime came back as now). Found by Henry's read of #177.
    expect(script, 'typecheck must not emit; it would rewrite the built MCP server').toMatch(/--noEmit/)
    expect(script, 'a per-project list can silently omit one; that is the defect this card is about').not.toMatch(/-p\s+tsconfig\./)
  })
})
