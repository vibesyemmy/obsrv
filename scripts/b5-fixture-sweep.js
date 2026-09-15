#!/usr/bin/env node
// The fixture half of the B5 sweep, committed so a second desk can run it.
//
// B5 measured whether the same page measured twice answers the same, and got
// zero over fixtures — on ONE machine, with the harness thrown away
// (docs/research/2026-09-14-b5-repeatability.md, "Reproducing it"). A zero
// from one desk cannot tell "the tool does not drift" from "this desk does not
// make it drift", and the Retina trio showed the difference is real: three
// assertions that turn on what monitor is plugged in, not on which machine.
//
// So this rebuilds the method rather than the scratch files, and adds the part
// the original could not have: it records THE DESK beside every number, since
// two hosts differing only in hardware tell you nothing if neither wrote down
// its display state.
//
//   node scripts/b5-fixture-sweep.js [--runs 3] [--all] [--out b5-<platform>.json]
//
// Exit code is 1 if the comparator fails its own control, and 0 otherwise —
// INCLUDING when fields moved. A difference is a result, not a failure; the
// card is done when the comparison exists, not when it comes out a particular
// way.
'use strict'

const { createServer } = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const { readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, extname, resolve } = require('node:path')
const os = require('node:os')

const root = resolve(__dirname, '..')
const flags = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = flags.indexOf(`--${name}`)
  return i === -1 || flags[i + 1] === undefined ? fallback : flags[i + 1]
}
const RUNS = Number(flag('runs', 3))
const PRESET = flag('preset', 'laptop-768')
/**
 * Where the CLI's Chromium profile lives, and whether fixtures may be cached.
 *
 * Both exist for one question: does a warm Chromium cache change what Obsrv
 * measures? (`bug-userdata-unbounded` — the app's profile is 1.3 GB, 915 MB of
 * it `Cache`, and a cap is the wrong fix if that cache is load-bearing for
 * repeatability.)
 *
 * By default this sweep is COLD by construction, and that is not a choice this
 * script made: `bin/obsrv.js` creates a throwaway user-data dir per invocation
 * and deletes it afterwards (its own comment says why — Chromium flushes
 * profile files after the last main-process JS runs). So every CLI run starts
 * with an empty cache, on any desk.
 *
 * `--profile <dir>` runs the built CLI entry directly under Electron with
 * OBSRV_CLI_USER_DATA set, which `src/cli/main.ts` honours, so the profile
 * persists across runs. `--cacheable` serves fixtures with a year's max-age
 * instead of `no-store`, since a cache cannot warm on responses it is
 * forbidden to keep. Warm needs both.
 */
const PROFILE = flag('profile', '')
const CACHEABLE = flags.includes('--cacheable')
const OUT = flag('out', join(root, `b5-sweep-${process.platform}.json`))

// The shapes drift would live in, from the original sweep's own list: pages
// that lazy-load, paint or render late, hydrate, grow as they are walked,
// reload mid-walk, replace themselves on scroll, app shells and sticky app
// shells, stuck chrome, a locked document, a dialog that steals the scroll, a
// wall over a tall page, and pages that never go quiet.
// Half of these are shapes where drift would live; the other half are pages
// that actually produce findings. A sweep over structural fixtures alone
// compares walk metadata and calls it stable: the first version of this list
// was seven shapes, and 9 of its 12 valid cases had zero findings, so "0 result
// fields moved" was a statement about 447 leaves, most of them the same four
// counts. The originals compared 3,375 leaves a run.
const CORE = [
  'lazy-tall.html',
  'paints-late.html',
  'grows-as-walked.html',
  'app-shell.html',
  'dialog-locked.html',
  'wall-over-a-tall-page.html',
  'animated-tall.html',
  'audit.html',
  'lint.html',
  'contrast.html',
  'hairline.html',
  'app-shell-findings.html',
]
const ALL = [
  ...CORE,
  'lazy.html',
  'renders-late.html',
  'hydrate.html',
  'blocks-after-load.html',
  'reloads-during-walk.html',
  'replaces-itself-on-scroll.html',
  'app-shell-findings.html',
  'app-shell-sticky.html',
  'stuck-chrome.html',
  'locked.html',
  'dialog-over-tall.html',
  'animated.html',
]
const FIXTURES = flags.includes('--all') ? ALL : CORE
const TOOLS = ['audit', 'lint']

/** Every fixture file read once into memory, so every run is served the same bytes. */
function serveFixtures() {
  const dir = join(root, 'tests', 'fixtures')
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' }
  const cache = new Map()
  for (const name of readdirSync(dir)) {
    try {
      cache.set(`/${name}`, { body: readFileSync(join(dir, name)), type: types[extname(name)] ?? 'application/octet-stream' })
    } catch {
      // A directory in there is not a fixture; skip it.
    }
  }
  const server = createServer((req, res) => {
    const hit = cache.get((req.url ?? '').split('?')[0])
    if (!hit) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': hit.type, 'content-length': hit.body.length, 'cache-control': CACHEABLE ? 'public, max-age=31536000, immutable' : 'no-store' })
    res.end(hit.body)
  })
  return new Promise(done => server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port })))
}

/** The desk this ran on. Two hosts that differ only in hardware say nothing if neither recorded this. */
function desk() {
  const d = {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memGiB: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    obsrv: require(join(root, 'package.json')).version,
    ci: process.env.CI === 'true' || process.env.CI === '1',
    displays: null,
  }
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('system_profiler', ['SPDisplaysDataType'], { encoding: 'utf8', timeout: 20_000 })
      // "UI Looks like" equal to "Resolution" is a 1x desk; half of it is 2x.
      d.displays = out
        .split('\n')
        .map(l => l.trim())
        .filter(l => /^(Resolution|UI Looks like|Main Display):/.test(l))
    } catch {
      d.displays = ['system_profiler unavailable']
    }
  }
  return d
}

/** Every leaf of a JSON value, as path -> value. */
function leaves(value, path = '', out = {}) {
  if (value === null || typeof value !== 'object') {
    out[path || '.'] = value
    return out
  }
  if (Array.isArray(value)) {
    out[`${path}.length`] = value.length
    value.forEach((v, i) => leaves(v, `${path}[${i}]`, out))
    return out
  }
  for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out)
  return out
}

/** Timing and path leaves are expected to move; everything else is a result. */
const TIMING = /(^|\.)(ms|settledMs|generatedAt|elapsed|durationMs|startedAt|finishedAt)$|Ms$/
const PATHY = /(^|\.)(out|url|path|file|files(\[|\.)|href)$/

/**
 * Which leaves differ across runs, classified — and for result leaves, WHAT
 * they differed between. The first version recorded only the key names, which
 * was enough to say a desk diverged and not enough to say how: CI reported
 * `pageHeight` moving on a page named for growing as it is walked, and the
 * numbers were in the artefact of a run that had already finished.
 */
function compare(runs) {
  const keys = new Set(runs.flatMap(r => Object.keys(r)))
  const moved = { timing: [], path: [], result: [], values: {} }
  for (const key of keys) {
    const seen = runs.map(r => JSON.stringify(r[key]))
    if (seen.every(v => v === seen[0])) continue
    const kind = TIMING.test(key) ? 'timing' : PATHY.test(key) ? 'path' : 'result'
    moved[kind].push(key)
    if (kind === 'result') moved.values[key] = seen.map(v => (v === undefined ? 'absent' : String(v).slice(0, 160)))
  }
  return moved
}

/**
 * A sweep that reports nothing fits two facts: the tool is deterministic, or
 * the comparator is blind. They are opposite, so the comparator is made to see
 * planted differences before any zero it reports is worth anything.
 */
function controlPasses(runs) {
  if (runs.length < 2) return { ok: false, why: 'fewer than two runs to plant into' }
  const plants = [
    ['a raised count', r => ({ ...r, 'summary.targets.under': (r['summary.targets.under'] ?? 0) + 1 })],
    ['a dropped finding', r => ({ ...r, 'findings.length': (r['findings.length'] ?? 1) - 1 })],
    ['a changed sentence', r => ({ ...r, 'warnings[0]': `${r['warnings[0]'] ?? ''} planted` })],
  ]
  for (const [name, mutate] of plants) {
    const copy = runs.map(r => ({ ...r }))
    copy[copy.length - 1] = mutate(copy[copy.length - 1])
    const seen = compare(copy)
    if (seen.result.length === 0) return { ok: false, why: `planting ${name} was invisible to the comparator` }
  }
  return { ok: true }
}

/**
 * Async on purpose. `spawnSync` here blocks this process's event loop, which
 * is also the fixture server's — so every run waited out its 30 s load budget
 * against a server that could not answer until the run it was serving had
 * finished. The first smoke run reported "result fields moved: 0" and "the
 * comparator saw every planted difference" over fourteen cases that had all
 * failed to load. Both greens were true and meaningless.
 */
function run(tool, url) {
  return new Promise(done => {
    const argv = PROFILE
      ? [join(root, 'out', 'main', 'cli.js'), '--', tool, url, '--preset', PRESET]
      : [join(root, 'bin', 'obsrv.js'), tool, url, '--preset', PRESET]
    // resolveElectron() answers { path }, not a path — the first run of this
    // arm spawned the object and died before a single measurement.
    const bin = PROFILE ? require(join(root, 'bin', 'electronPath.js')).resolveElectron().path : process.execPath
    const env = { ...process.env }
    if (PROFILE) {
      env.OBSRV_CLI_USER_DATA = PROFILE
      delete env.ELECTRON_RUN_AS_NODE
    }
    const child = spawn(bin, argv, { env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (err += d))
    child.on('close', status => {
      clearTimeout(timer)
      if (status !== 0) return done({ error: `exit ${status}: ${err.trim().split('\n').slice(-2).join(' ')}` })
      try {
        done({ json: JSON.parse(out) })
      } catch {
        done({ error: `stdout was not JSON: ${out.slice(0, 120)}` })
      }
    })
  })
}

/**
 * Did this run measure the page at all? A case that never loaded is stable
 * across runs for the worst possible reason, and the planted-difference
 * control cannot see it: plants go into the saved leaves, so they still differ
 * when every run is equally empty. This is the second guard, and it
 * checks the thing the first one structurally cannot.
 */
function measured(json) {
  const said = [...(json.warnings ?? []), ...(json.notes ?? [])].join(' ')
  // "nothing to measure" is NOT this: a page with no text and no targets is a
  // legitimate case whose sentence is the thing to compare across runs, and
  // the original sweep's strongest result was five such cases whose notes were
  // byte-identical. Only a load that never arrived makes a run empty of
  // evidence rather than empty of findings.
  if (/load did not finish|did not answer within|never answered/i.test(said)) return `the load did not finish: ${said.slice(0, 90)}`
  if (!(Number(json.pageHeight) > 0)) return `pageHeight is ${JSON.stringify(json.pageHeight)}`
  return null
}

async function main() {
  const { server, port } = await serveFixtures()
  const started = Date.now()
  const cases = []
  for (const fixture of FIXTURES) {
    for (const tool of TOOLS) {
      const url = `http://127.0.0.1:${port}/${fixture}`
      const runs = []
      let failed = null
      for (let i = 0; i < RUNS; i++) {
        const r = await run(tool, url)
        if (r.error) {
          failed = r.error
          break
        }
        const unmeasured = measured(r.json)
        if (unmeasured) {
          failed = `run ${i + 1} measured nothing — ${unmeasured}`
          break
        }
        runs.push(leaves(r.json))
      }
      if (failed) {
        cases.push({ case: `${fixture} ${tool}`, error: failed })
        process.stdout.write(`  ${fixture} ${tool}: ERROR ${failed}\n`)
        continue
      }
      const moved = compare(runs)
      const control = controlPasses(runs)
      cases.push({
        case: `${fixture} ${tool}`,
        runs: runs.length,
        leaves: Object.keys(runs[0]).length,
        moved,
        control,
        // A case that measures nothing is stable for a reason that is not
        // determinism, so the sweep says so rather than counting it as stable.
        findings: runs[0]['findings.length'] ?? null,
        notes: (runs[0]['warnings[0]'] ?? runs[0]['notes[0]'] ?? null),
      })
      const verdict = moved.result.length === 0 ? 'result fields moved: 0' : `RESULT FIELDS MOVED: ${moved.result.length} (${moved.result.slice(0, 4).join(', ')})`
      process.stdout.write(`  ${fixture} ${tool}: ${verdict}${control.ok ? '' : `  CONTROL FAILED: ${control.why}`}\n`)
    }
  }
  server.close()

  const blind = cases.filter(c => c.control && !c.control.ok)
  const movedCases = cases.filter(c => c.moved && c.moved.result.length > 0)
  const errors = cases.filter(c => c.error)
  const empty = cases.filter(c => c.findings === 0)
  const report = {
    desk: desk(),
    preset: PRESET,
    runs: RUNS,
    cache: { profile: PROFILE || 'throwaway per run (bin/obsrv.js)', cacheable: CACHEABLE },
    fixtures: FIXTURES,
    tools: TOOLS,
    elapsedMs: Date.now() - started,
    totals: {
      cases: cases.length,
      casesWithMovedResultFields: movedCases.length,
      resultFieldsMoved: movedCases.reduce((n, c) => n + c.moved.result.length, 0),
      casesMeasuringNothing: empty.length,
      errors: errors.length,
      comparatorBlindOn: blind.length,
    },
    cases,
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`)

  const t = report.totals
  process.stdout.write(
    `\nB5 fixture sweep — ${t.cases} cases × ${RUNS} runs on ${report.desk.platform}/${report.desk.arch}` +
      `${report.desk.ci ? ' (CI)' : ''}\n` +
      `  result fields moved: ${t.resultFieldsMoved} across ${t.casesWithMovedResultFields} cases\n` +
      `  cases measuring nothing: ${t.casesMeasuringNothing} (read them; zero findings is stable for a reason that is not determinism)\n` +
      `  errors: ${t.errors}\n` +
      `  comparator control: ${t.comparatorBlindOn === 0 ? 'saw every planted difference' : `BLIND on ${t.comparatorBlindOn} cases`}\n` +
      `  desk: ${report.desk.cpu}, ${report.desk.cores} cores${report.desk.displays ? `; ${report.desk.displays.join(' | ')}` : ''}\n` +
      `  written: ${OUT}\n` +
      `\nCompare against docs/research/2026-09-14-b5-repeatability.md, whose fixture number is 0 on one desk.\n` +
      'A difference here is a result about that desk, not a failure of this run.\n',
  )
  // Only a blind comparator or a broken run is a failure; a difference is the
  // measurement this exists to take.
  process.exit(blind.length > 0 || errors.length > 0 ? 1 : 0)
}

main().catch(e => {
  process.stderr.write(`b5-fixture-sweep: ${e && e.stack ? e.stack : e}\n`)
  process.exit(1)
})
