import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Both launch paths drop the Dock icon at module top, before `whenReady`
 * (bug-e2e-takes-the-desk). Measured on a CI runner (run 35160584859): the
 * harness app's icon was up about 1.1 s when hidden at `ready-to-show` and
 * about 80 ms at module top; the CLI's about 110 ms in `whenReady` and about
 * 30 ms with the activation policy at module top. A module-top statement has
 * no unit to test, so a tidy that moved either call into `whenReady` would pass
 * every other check (Wren's read of #174). This reads the two entry points.
 */

const ROOT = resolve(__dirname, '../..')

/** The line index of the first line matching `re`, or -1. */
function lineOf(lines: string[], re: RegExp): number {
  return lines.findIndex(l => re.test(l))
}

describe('the Dock icon is dropped at launch', () => {
  const cases = [
    { file: 'src/main/index.ts', drop: /^if \(showsInactive\(\)\) app\.dock\?\.hide\(\)\s*$/, ready: /^\s*void app\.whenReady\(\)/ },
    { file: 'src/cli/main.ts', drop: /^if \(process\.platform === 'darwin'\) app\.setActivationPolicy\('accessory'\)\s*$/, ready: /^void app\.whenReady\(\)/ },
  ]
  for (const c of cases) {
    it(`${c.file}: at module top, before whenReady`, () => {
      const lines = readFileSync(resolve(ROOT, c.file), 'utf8').split('\n')
      const ready = lineOf(lines, c.ready)
      // Not vacuous: the file still has the whenReady this is ordered against.
      expect(ready, `no whenReady found in ${c.file}`).toBeGreaterThan(0)
      const drop = lineOf(lines, c.drop)
      // Unindented, so it is not inside a function body.
      expect(drop, `${c.file} no longer drops the Dock icon at module top`).toBeGreaterThan(-1)
      expect(drop, `${c.file} drops the Dock icon after whenReady`).toBeLessThan(ready)
    })
  }
})
