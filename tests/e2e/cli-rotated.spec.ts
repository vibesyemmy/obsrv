import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `snap --json` names the rotation it rendered at (`chore-cli-json-rotated`).
 *
 * MCP's replies have carried `rotated` since `rotate` landed; the CLI's JSON swapped the dimensions
 * and named the rotation nowhere, so an agent reading it could not tell a rotated `1080p-24` from a
 * portrait monitor of the same size. Measured before the change, at 0.63.1:
 *
 *     keys: cssHeight cssWidth deviceScaleFactor out preset profile settled url warnings
 *     --rotate → cssWidth 852, cssHeight 393, and no field saying why
 *
 * **Why this is a new file rather than a case in `cli.spec.ts`.** That file guards the flagless JSON
 * contract and **no session edits it without Opeyemi's explicit authorisation**. The card assumed the
 * key would change what it guards; it does not, because the key is keyed on the flag — exactly as
 * `tiled`, `textScale` and `throttle` are, and for the reason `main.ts` gives beside them: *"the
 * flagless JSON is a contract"*. So the guarded run is byte-identical and the assertion lives here.
 */
const BIN = resolve(__dirname, '../../bin/obsrv.js')
const PAGE = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    // Captured because a refusal is the subject of one test below, and an
    // argument error is written here rather than to stdout.
    child.stderr.on('data', d => (stderr += d))
    child.on('close', code => done({ code, stdout, stderr }))
  })
}

let outDir: string
test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'obsrv-cli-rotated-'))
})
test.afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test.describe.configure({ timeout: 120_000 })

const snap = async (...extra: string[]): Promise<Record<string, unknown>> => {
  const out = join(outDir, `${extra.join('_').replace(/[^a-z0-9]+/gi, '') || 'plain'}.png`)
  const r = await runCli(['snap', PAGE, '--preset', 'iphone-61', '--out', out, ...extra])
  expect(r.code, 'the CLI did not exit 0').toBe(0)
  return JSON.parse(r.stdout) as Record<string, unknown>
}

test('a rotated render says so, and the dimensions agree with the word', async () => {
  const json = await snap('--rotate')
  expect(json.rotated).toBe(true)
  // The dims are the assertion's other half: `rotated: true` beside a portrait
  // viewport would be a field that names nothing. iphone-61 is 393x852 stored.
  expect({ w: json.cssWidth, h: json.cssHeight }).toEqual({ w: 852, h: 393 })
})

test('the removed --orientation flag is refused, and the refusal names --rotate', async () => {
  // This test used to pass `--orientation portrait` and assert `rotated: false`
  // — the flag asked by name and answered no. The flag is gone in the breaking
  // release (`docs/breaking-changes.md`), so what is worth guarding is the
  // REFUSAL: an unknown flag already fails the run, and the addition is that
  // the message names the replacement. A caller whose script still passes the
  // old flag cannot fix it from "unknown flag" alone (Wren, room #4019).
  const r = await runCli(['snap', PAGE, '--preset', 'iphone-61', '--orientation', 'portrait'])
  expect(r.code, 'the CLI accepted a flag that no longer exists').not.toBe(0)
  const said = `${r.stderr}\n${r.stdout}`
  expect(said).toContain('unknown flag: --orientation')
  expect(said, 'the refusal does not say what to use instead').toContain('--rotate')
})

test('a run that named no rotation carries no rotated key at all', async () => {
  // **The contract `cli.spec.ts` guards, asserted from this side.** If this key
  // ever appears unconditionally, that file's expectations still pass —
  // `toMatchObject` is a subset check — and the flagless JSON would have changed
  // with nothing to say so. This is the assertion that would notice.
  const json = await snap()
  expect(Object.keys(json)).not.toContain('rotated')
  expect(Object.keys(json).sort()).toEqual([
    'cssHeight',
    'cssWidth',
    'deviceScaleFactor',
    'out',
    'preset',
    'profile',
    'settled',
    'url',
    'warnings',
  ])
})
