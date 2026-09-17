import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_NAME, defaultControlFilePath } from '../../src/shared/control'

/**
 * Every launch path names the app the same, so its profile, control file and
 * log land where the MCP server's `discover()` looks (a3). The package's own
 * Electron runs `out/main/index.js` directly, and Electron names an app
 * launched that way "Electron": measured on a CI runner (run 35168639669),
 * its `control.json` was in `Application Support/Electron`.
 */
const ROOT = resolve(__dirname, '../..')

describe('the app name', () => {
  it("is package.json's productName, which is what a packaged app is called", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { productName?: string }
    expect(APP_NAME).toBe(pkg.productName)
  })

  it('is the directory the MCP server looks in for the control file', () => {
    expect(defaultControlFilePath('darwin', {}, '/h')).toBe(`/h/Library/Application Support/${APP_NAME}/control.json`)
  })

  it('is set by the main process before anything reads a path', () => {
    const lines = readFileSync(resolve(ROOT, 'src/main/index.ts'), 'utf8').split('\n')
    const set = lines.findIndex(l => /^app\.setName\(APP_NAME\)\s*$/.test(l))
    const log = lines.findIndex(l => /initLog\(\)/.test(l) && !l.trim().startsWith('import'))
    const lock = lines.findIndex(l => /requestSingleInstanceLock\(\)/.test(l))
    // Not vacuous: the reads it is ordered against are still there.
    expect(log, 'initLog() not found in src/main/index.ts').toBeGreaterThan(0)
    expect(lock, 'requestSingleInstanceLock() not found in src/main/index.ts').toBeGreaterThan(0)
    expect(set, 'src/main/index.ts no longer sets the app name at module top').toBeGreaterThan(-1)
    expect(set).toBeLessThan(log)
    expect(set).toBeLessThan(lock)
  })
})
