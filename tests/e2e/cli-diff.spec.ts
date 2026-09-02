import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `obsrv diff` with a panel profile. The profile used to be applied to the
 * target before measuring, and a profile's brightness and black floor darken
 * every pixel of a mostly-white page past the ink threshold: 100% coverage,
 * a "+90pp" finding in every band, against an unprofiled reference. The
 * comparison is about rasterisation and is now measured without the profile,
 * with a warning saying so. Here rather than in cli.spec.ts, which is closed.
 */

const BIN = resolve(__dirname, '../../bin/obsrv.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: resolve(__dirname, '../..') })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', rejectPromise)
    child.on('close', code => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

test('a panel profile does not darken the diff into 100% ink, and the output says it was not applied', async () => {
  const r = await runCli(['diff', fixture('thin-text.html'), '--preset', 'laptop-768', '--profile', 'budget-tn'])
  expect(r.code, r.stderr).toBe(0)
  const m = JSON.parse(r.stdout)
  expect(m.profile).toBe('budget-tn')
  // A page of thin text is a few percent ink; the defect reported 100%.
  expect(m.inkCoverage.target).toBeLessThan(0.2)
  expect(Math.abs(m.inkCoverage.delta)).toBeLessThan(0.2)
  expect(m.warnings.join(' ')).toMatch(/budget-tn.*not applied to a diff/)
})

test('the reference profile adds no such warning', async () => {
  const r = await runCli(['diff', fixture('thin-text.html'), '--preset', 'laptop-768'])
  expect(r.code, r.stderr).toBe(0)
  expect(JSON.parse(r.stdout).warnings.join(' ')).not.toMatch(/not applied/)
})
