import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * No e2e test fronts the app under test by hand (bug-e2e-takes-the-desk). On
 * macOS `win.show()`, `win.focus()` and `app.focus()` activate the app and take
 * the desk from whoever is using the machine; the harness shows its window with
 * `showInactive()` instead. A test whose job needs a front app (the
 * `focusWindow` command, the overlay's focus hand-off with
 * `OBSRV_TEST_TAKES_THE_DESK`) is gated by name on the same line
 * (`OBSRV_E2E_FRONT`), so it never matches here.
 */

const ROOT = resolve(__dirname, '../..')
const FRONTS = /\bwin\.(show|focus)\(\)|\bapp\.focus\(|\bfocus:\s*true\b|\bOBSRV_TEST_TAKES_THE_DESK\b/

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tsFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('e2e tests and the desk', () => {
  it('never front the app under test by calling show or focus directly', () => {
    const files = tsFiles(join(ROOT, 'tests/e2e'))
    // Not vacuous: the walk reaches the specs and the helper that used to front the app.
    expect(files.length).toBeGreaterThan(50)
    expect(files.map(f => relative(ROOT, f))).toEqual(expect.arrayContaining(['tests/e2e/helpers/deskState.ts', 'tests/e2e/visibility.spec.ts']))
    const found = files.flatMap(f =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          FRONTS.test(line) && !line.includes('OBSRV_E2E_FRONT') && !line.trim().startsWith('//') && !line.trim().startsWith('*')
            ? [`${relative(ROOT, f)}:${i + 1}`]
            : [],
        ),
    )
    expect(found, 'use win.showInactive(), or gate a test that must front the app by name (OBSRV_E2E_FRONT)').toEqual([])
  })
})
